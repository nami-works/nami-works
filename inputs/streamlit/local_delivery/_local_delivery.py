"""
Local Delivery - Complete implementation including delivery address mapping and route planning
"""

import streamlit as st
import pandas as pd
import folium
from folium import plugins
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timedelta, date, timezone
from zoneinfo import ZoneInfo
import asyncio
import json
import os
import math
import urllib.request
import urllib.parse
from pathlib import Path
from apis.shopify.shopify_connector import ShopifyGraphQLClient
from functions.shared.ui_helpers import render_section_header, render_subsection_header
from functions.shared.button_styles import apply_primary_button_styles, render_dual_buttons, render_primary_button
from functions.shared.coordinate_utils import extract_coordinates_from_shipping_address, validate_coordinates
from translations import LANG, get_current_language
from functions.geocommerce.core.api_data_processor import GeocodingService
from .context import LOCAL_DELIVERY_CONTEXT
from .shipment_requests import ShipmentRequestProcessor

# GraphQL query to fetch orders with shipping addresses and coordinates
ORDERS_WITH_COORDINATES_QUERY = """
query GetOrdersWithCoordinates($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query) {
    edges {
      node {
        id
        name
        displayFulfillmentStatus
        cancelledAt
        displayFinancialStatus
        tags
        shippingLine {
          title
          code
          originalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
        }
        shippingAddress {
          address1
          address2
          city
          province
          country
          zip
          latitude
          longitude
          name
          phone
          coordinatesValidated
        }
        customer {
          id
          email
        }
        fulfillments(first: 10) {
          id
          status
          displayStatus
          location {
            id
            name
            address {
              address1
              city
              province
              country
              zip
            }
          }
          trackingInfo {
            company
          }
        }
        createdAt
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
"""

# GraphQL query to fetch shipment requests orders (pre-filtered)
# Filters: LOCAL tag, not fulfilled, assigned to CD Cajamar or CD Extrema
SHIPMENT_REQUESTS_QUERY = """
query GetShipmentRequests($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query) {
    edges {
      node {
        id
        name
        displayFulfillmentStatus
        tags
        shippingAddress {
          address1
          address2
          city
          province
          country
          zip
          latitude
          longitude
          name
          phone
        }
        customer {
          id
          email
          firstName
          lastName
        }
        fulfillments(first: 10) {
          id
          status
          displayStatus
          location {
            id
            name
          }
        }
        createdAt
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
"""

# GraphQL query to fetch locations
LOCATIONS_QUERY = """
query GetLocations($first: Int!) {
  locations(first: $first) {
    edges {
      node {
        id
        name
        address {
          address1
          address2
          city
          province
          country
          zip
          latitude
          longitude
        }
      }
    }
  }
}
"""

# GraphQL query to fetch orders by IDs (for tag cleanup)
ORDERS_BY_IDS_QUERY = """
query GetOrdersByIds($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Order {
      id
      name
      shippingAddress {
        province
      }
    }
  }
}
"""

class DeliveryAddressMapper:
    """Maps delivery addresses from orders onto an interactive map"""
    
    # Province to Fulfillment Location mapping
    PROVINCE_TO_LOCATION_MAP = {
        'Ceará': 'Iguatemi Fortaleza',
        'CE': 'Iguatemi Fortaleza',
        'Pernambuco': 'Shopping Recife',
        'PE': 'Shopping Recife',
        'Rio de Janeiro': 'RioSul',
        'RJ': 'RioSul',
        'São Paulo': 'Shops Jardins',
        'SP': 'Shops Jardins',
    }
    
    def __init__(self):
        self.config = None
        self.available_fulfillment_locations = []
        self.available_fulfillment_statuses = []
        self.geocoding_service = GeocodingService()
        try:
            from functions.geocommerce.config.config import ShopifyConfig
            self.config = ShopifyConfig.from_env()
        except Exception:
            # Configuration will be checked when needed
            pass
        
        # Initialize route management in session state
        if 'delivery_routes' not in st.session_state:
            st.session_state.delivery_routes = {}
            # Initialize preset routes (rota-01 through rota-10) at session start
            for i in range(1, 11):
                route_name = f"rota-{i:02d}"
                route_id = f"route_{i:02d}"
                st.session_state.delivery_routes[route_id] = {
                    'name': route_name,
                    'order_ids': []
                }
        if 'selected_orders' not in st.session_state:
            st.session_state.selected_orders = set()
        if 'next_route_number' not in st.session_state:
            st.session_state.next_route_number = 11  # Start from 11 since 1-10 are presets
    
    def _is_presale_tag(self, tag: str) -> bool:
        """
        Check if a tag is a pre-sale tag.
        Recognizes any tag starting with "pre-venda" (case-insensitive, with or without accent).
        Pre-venda tags do not have dates - they are simply recognized by the prefix.
        
        Args:
            tag: Tag string to check
            
        Returns:
            True if tag is a pre-sale tag, False otherwise
        """
        tag_lower = tag.lower()
        # Check for both "pré-venda" and "pre-venda" patterns (without requiring trailing dash)
        return tag_lower.startswith("pré-venda") or tag_lower.startswith("pre-venda")
    
    def _has_active_presale_tags(self, tags: List[str]) -> bool:
        """
        Check if order has any active pre-sale tags.
        Pre-venda tags don't have dates - any tag starting with "pre-venda" is considered active.
        
        Args:
            tags: List of order tags (can be list or comma-separated string)
            
        Returns:
            True if order has pre-sale tags (should be filtered out)
            False if no pre-sale tags
        """
        # Normalize tags to list
        if isinstance(tags, str):
            tags = [tag.strip() for tag in tags.split(',') if tag.strip()]
        elif not isinstance(tags, list):
            return False
        
        # Find all pre-sale tags (any tag starting with "pre-venda")
        presale_tags = [tag for tag in tags if self._is_presale_tag(tag)]
        
        # If any pre-sale tag exists, order is in pre-sale (no date checking)
        return len(presale_tags) > 0
    
    def _extract_presale_tags_from_orders(self, orders: List[Dict]) -> List[str]:
        """
        Extract all unique pre-sale tags from a list of orders.
        Recognizes any tag starting with "pre-venda" (case-insensitive, with or without accent).
        
        Args:
            orders: List of order dictionaries
            
        Returns:
            Sorted list of unique pre-sale tags (any tag starting with "pre-venda")
        """
        presale_tags_set = set()
        
        for order in orders:
            tags = order.get('tags', [])
            
            # Normalize tags to list
            if isinstance(tags, str):
                tags = [tag.strip() for tag in tags.split(',') if tag.strip()]
            elif not isinstance(tags, list):
                continue
            
            # Find all pre-sale tags (both patterns)
            for tag in tags:
                if self._is_presale_tag(tag):
                    presale_tags_set.add(tag)
        
        # Return sorted list (for consistent display)
        return sorted(list(presale_tags_set))
    
    def _get_order_emoji(self, tags: List[str], is_fulfilled: bool) -> str:
        """
        Determine the correct emoji for an order based on tags and fulfillment status.
        
        Rules:
        - When NOT fulfilled:
          - Regular (no delivery issues): 📦
          - Only ld_reentrega: 🔄
          - Both ld_devolucao AND ld_reentrega: 🔄↩️
        - When fulfilled AND has ld_devolucao: ↩️
        
        Returns:
            - 📦 for regular orders (not fulfilled, no delivery issues) - shown on map only
            - 🔄 for orders with only ld_reentrega (not fulfilled) - shown on both map and list
            - 🔄↩️ for orders with both ld_devolucao and ld_reentrega (not fulfilled) - shown on both map and list
            - ↩️ for fulfilled orders with ld_devolucao - shown on both map and list
        """
        has_devolucao = 'ld_devolucao' in tags
        has_reentrega = 'ld_reentrega' in tags
        
        if not is_fulfilled:
            # Not fulfilled cases
            if has_reentrega and has_devolucao:
                # Both tags: show 🔄↩️
                return "🔄↩️"
            elif has_reentrega:
                # Only ld_reentrega: show 🔄
                return "🔄"
            else:
                # Regular order (no delivery issues) or only ld_devolucao (without ld_reentrega): show 📦
                return "📦"
        else:
            # Fulfilled cases
            if has_devolucao:
                # Fulfilled with ld_devolucao: show ↩️
                return "↩️"
            else:
                # Fulfilled but no delivery issues (shouldn't happen due to filtering, but handle it): show 📦
                return "📦"
    
    def _validate_address_format(self, address1: str, address2: str) -> Dict[str, Any]:
        """
        Validate address format to detect apartment/suite info incorrectly placed in address1.
        
        Detects two patterns:
        1. Apartment keywords (Apt, Suite, etc.) appearing in address1 before street number
        2. Same number appearing in both address1 and address2 (duplicate apartment number)
        
        Args:
            address1: First address line
            address2: Second address line (apartment/suite info)
            
        Returns:
            Dict with validation status and suggested corrections:
            {
                'is_valid': bool,
                'issue_type': str,  # 'apartment_in_address1', 'duplicate_number', None
                'suggested_address1': str,
                'suggested_address2': str
            }
        """
        import re
        
        if not address1:
            return {
                'is_valid': True,
                'issue_type': None,
                'suggested_address1': address1,
                'suggested_address2': address2
            }
        
        address1_clean = address1.strip()
        address2_clean = address2.strip() if address2 else ''
        
        # Pattern 1: Check for apartment keywords in address1 before street number
        apartment_keywords = [
            r'\bApt\b', r'\bApto\b', r'\bApartamento\b', r'\bApt\.\b',
            r'\bSuite\b', r'\bSuíte\b', r'\bBloco\b', r'\bBl\b',
            r'\bCasa\b', r'\bSala\b', r'\bAndar\b', r'\bFloor\b'
        ]
        
        # Extract all numbers from address1 and address2
        numbers_in_address1 = re.findall(r'\b\d+\b', address1_clean)
        numbers_in_address2 = re.findall(r'\b\d+\b', address2_clean) if address2_clean else []
        
        # Pattern 2: Check if same number appears in both fields
        duplicate_numbers = set(numbers_in_address1) & set(numbers_in_address2)
        
        # Check for apartment keywords
        has_apartment_keyword = False
        apartment_match = None
        for keyword_pattern in apartment_keywords:
            match = re.search(keyword_pattern, address1_clean, re.IGNORECASE)
            if match:
                has_apartment_keyword = True
                apartment_match = match
                break
        
        # If apartment keyword found, check if street number appears after it
        if has_apartment_keyword and apartment_match:
            # Extract text after apartment keyword
            after_apartment = address1_clean[apartment_match.end():].strip()
            # Check if there's a number after the apartment keyword (likely street number)
            numbers_after = re.findall(r'\b\d+\b', after_apartment)
            if numbers_after:
                # Street number found after apartment - this is invalid
                # Try to extract apartment number and street number
                apartment_num_match = re.search(r'\b\d+\b', after_apartment)
                if apartment_num_match:
                    apartment_num = apartment_num_match.group()
                    # Remove apartment info from address1
                    suggested_addr1 = re.sub(
                        rf'{apartment_match.group()}\s*{apartment_num}[,\s]*',
                        '',
                        address1_clean,
                        flags=re.IGNORECASE
                    ).strip()
                    suggested_addr2 = f"{apartment_match.group()} {apartment_num}"
                    return {
                        'is_valid': False,
                        'issue_type': 'apartment_in_address1',
                        'suggested_address1': suggested_addr1,
                        'suggested_address2': suggested_addr2
                    }
        
        # Pattern 2: Check for duplicate numbers
        if duplicate_numbers:
            # If a number appears in both fields, it's likely apartment number in wrong place
            # This is a potential issue
            return {
                'is_valid': False,
                'issue_type': 'duplicate_number',
                'suggested_address1': address1_clean,  # Keep as is, user will correct
                'suggested_address2': address2_clean
            }
        
        # Address appears valid
        return {
            'is_valid': True,
            'issue_type': None,
            'suggested_address1': address1_clean,
            'suggested_address2': address2_clean
        }
    
    def _get_order_age_days(self, order: Dict[str, Any]) -> Optional[int]:
        """Get order age in days using Brasília time."""
        created_at = order.get('created_at', '')
        if not created_at:
            return None
        
        try:
            dt = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
            brasilia_tz = ZoneInfo('America/Sao_Paulo')
            dt_brasilia = dt.astimezone(brasilia_tz)
            order_date = dt_brasilia.date()
            today_brasilia = datetime.now(brasilia_tz).date()
            return (today_brasilia - order_date).days
        except (ValueError, AttributeError, Exception):
            return None
    
    def _is_order_from_today(self, order: Dict[str, Any]) -> bool:
        """Check if order was created today (present day) using GMT-3 (Brasília time)."""
        created_at = order.get('created_at', '')
        if not created_at:
            return False
        
        try:
            # Parse ISO format date (handles timezone)
            dt = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
            
            # Convert to Brasília time (GMT-3 / America/Sao_Paulo)
            brasilia_tz = ZoneInfo('America/Sao_Paulo')
            dt_brasilia = dt.astimezone(brasilia_tz)
            order_date = dt_brasilia.date()
            
            # Get today's date in Brasília timezone
            today_brasilia = datetime.now(brasilia_tz).date()
            
            return order_date == today_brasilia
        except (ValueError, AttributeError, Exception):
            return False
    
    def _get_color_palette(self) -> List[str]:
        """
        Get color palette inspired by transit maps (distinct, high-contrast colors).
        
        Returns:
            List of hex color codes
        """
        return [
            '#000000',  # Black
            '#003366',  # Dark Blue
            '#0066CC',  # Light Blue
            '#CC0000',  # Red
            '#FF69B4',  # Pink
            '#FFD700',  # Yellow/Gold
            '#FF6600',  # Orange
            '#8B4513',  # Brown
            '#00AA00',  # Green
            '#808080',  # Light Grey
            '#800080'   # Purple
        ]
    
    def _get_nearby_orders(self, order: Dict[str, Any], all_orders: List[Dict], threshold: float = 500.0) -> List[Dict]:
        """
        Find orders within distance threshold of the given order.
        
        Args:
            order: Order to find neighbors for
            all_orders: List of all orders
            threshold: Distance threshold in meters
            
        Returns:
            List of nearby orders
        """
        from math import radians, cos, sin, asin, sqrt
        
        def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
            """Calculate distance between two points in meters using Haversine formula."""
            R = 6371000  # Earth radius in meters
            lat1_rad = radians(lat1)
            lat2_rad = radians(lat2)
            delta_lat = radians(lat2 - lat1)
            delta_lon = radians(lon2 - lon1)
            
            a = sin(delta_lat / 2) ** 2 + cos(lat1_rad) * cos(lat2_rad) * sin(delta_lon / 2) ** 2
            c = 2 * asin(sqrt(a))
            
            return R * c
        
        order_lat = order.get('latitude')
        order_lng = order.get('longitude')
        order_id = order.get('order_id')
        
        if not order_lat or not order_lng:
            return []
        
        nearby = []
        for other_order in all_orders:
            other_id = other_order.get('order_id')
            if other_id == order_id:
                continue
            
            other_lat = other_order.get('latitude')
            other_lng = other_order.get('longitude')
            
            if not other_lat or not other_lng:
                continue
            
            distance = haversine_distance(order_lat, order_lng, other_lat, other_lng)
            if distance <= threshold:
                nearby.append(other_order)
        
        return nearby
    
    def _assign_order_color(self, order: Dict[str, Any], nearby_orders: List[Dict], color_palette: List[str], used_colors: Dict[str, str]) -> str:
        """
        Assign color to order, avoiding conflicts with nearby orders.
        
        Uses greedy algorithm: assign first available color not used by nearby orders.
        
        Args:
            order: Order to assign color to
            nearby_orders: List of nearby orders
            color_palette: Available colors
            used_colors: Dict mapping order_id to assigned color
            
        Returns:
            Hex color code
        """
        # If order is assigned to a route, use route color
        route_tag = order.get('route_tag', '')
        if route_tag:
            route_color = self._get_route_color(route_tag)
            if route_color:
                return route_color
        
        # Get colors used by nearby orders
        nearby_colors = set()
        for nearby_order in nearby_orders:
            nearby_id = nearby_order.get('order_id', '')
            if nearby_id in used_colors:
                nearby_colors.add(used_colors[nearby_id])
        
        # Find first available color not used by nearby orders
        for color in color_palette:
            if color not in nearby_colors:
                return color
        
        # If all colors are used, return first color (fallback)
        return color_palette[0] if color_palette else '#808080'
    
    def _get_driving_route(self, origin: Tuple[float, float], destination: Tuple[float, float]) -> List[Tuple[float, float]]:
        """
        Get the shortest driving route coordinates from origin to destination using OSRM routing API.
        
        Args:
            origin: Tuple of (latitude, longitude) for origin point
            destination: Tuple of (latitude, longitude) for destination point
            
        Returns:
            List of (latitude, longitude) tuples for the shortest route.
        """
        try:
            # OSRM public instance URL with alternatives support
            # Format: http://router.project-osrm.org/route/v1/driving/{lon1},{lat1};{lon2},{lat2}?overview=full&geometries=geojson&alternatives=true
            lat1, lon1 = origin
            lat2, lon2 = destination
            
            # OSRM expects longitude,latitude format
            url = f"http://router.project-osrm.org/route/v1/driving/{lon1},{lat1};{lon2},{lat2}?overview=full&geometries=geojson&alternatives=true"
            
            # Make request to OSRM API
            with urllib.request.urlopen(url, timeout=5) as response:
                data = json.loads(response.read().decode())
                
                # Check if route was found
                if data.get('code') == 'Ok' and data.get('routes'):
                    routes = data['routes']
                    # Select the shortest route option
                    shortest_route = min(routes, key=lambda route: route.get('distance', float('inf')))
                    geometry = shortest_route.get('geometry', {})
                    
                    # Extract coordinates from GeoJSON geometry
                    if geometry.get('type') == 'LineString':
                        coordinates = geometry.get('coordinates', [])
                        # Convert from [lon, lat] to [lat, lon] format for Folium
                        return [(coord[1], coord[0]) for coord in coordinates]
                
                # If no route found, return straight line as fallback
                return [origin, destination]
                
        except Exception as e:
            # On error, return straight line as fallback
            st.warning(f"Error getting route from OSRM: {str(e)}")
            return [origin, destination]
    
    def _optimize_route_sequence(
        self,
        route_orders: List[Dict],
        start_coords: Optional[Tuple[float, float]] = None
    ) -> List[Dict]:
        """
        Optimize route sequence using OSRM trip optimization when possible.
        
        Args:
            route_orders: List of orders assigned to a route
            start_coords: Optional (latitude, longitude) for fixed route start
            
        Returns:
            List of orders in optimized sequence
        """
        from math import radians, cos, sin, asin, sqrt
        
        def has_coords(order: Dict[str, Any]) -> bool:
            """Check if an order has valid coordinates."""
            return bool(order.get('latitude')) and bool(order.get('longitude'))
        
        def try_osrm_trip(orders_with_coords: List[Dict], origin: Tuple[float, float]) -> Optional[List[Dict]]:
            """Use OSRM trip optimization to find the shortest sequence."""
            try:
                coords = [origin] + [(order['latitude'], order['longitude']) for order in orders_with_coords]
                coords_param = ";".join([f"{lon},{lat}" for lat, lon in coords])
                url = (
                    f"http://router.project-osrm.org/trip/v1/driving/{coords_param}"
                    f"?source=first&roundtrip=false&overview=false"
                )
                
                with urllib.request.urlopen(url, timeout=10) as response:
                    data = json.loads(response.read().decode())
                
                if data.get('code') != 'Ok' or not data.get('waypoints'):
                    return None
                
                waypoints = data['waypoints']
                indexed = []
                for input_idx, waypoint in enumerate(waypoints):
                    waypoint_index = waypoint.get('waypoint_index')
                    if waypoint_index is not None:
                        indexed.append((input_idx, waypoint_index))
                
                if not indexed:
                    return None
                
                ordered_input_indices = [idx for idx, _ in sorted(indexed, key=lambda item: item[1])]
                optimized_orders = []
                for input_idx in ordered_input_indices:
                    if input_idx == 0:
                        continue  # Skip fixed origin
                    order_idx = input_idx - 1
                    if 0 <= order_idx < len(orders_with_coords):
                        optimized_orders.append(orders_with_coords[order_idx])
                
                return optimized_orders if optimized_orders else None
            except Exception as e:
                st.warning(f"Error optimizing trip with OSRM: {str(e)}")
                return None
        
        def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
            """Calculate distance between two points in meters using Haversine formula."""
            R = 6371000  # Earth radius in meters
            lat1_rad = radians(lat1)
            lat2_rad = radians(lat2)
            delta_lat = radians(lat2 - lat1)
            delta_lon = radians(lon2 - lon1)
            
            a = sin(delta_lat / 2) ** 2 + cos(lat1_rad) * cos(lat2_rad) * sin(delta_lon / 2) ** 2
            c = 2 * asin(sqrt(a))
            
            return R * c
        
        if len(route_orders) <= 1:
            return route_orders
        
        orders_with_coords = [order for order in route_orders if has_coords(order)]
        orders_without_coords = [order for order in route_orders if not has_coords(order)]
        
        if start_coords and len(orders_with_coords) > 1:
            optimized = try_osrm_trip(orders_with_coords, start_coords)
            if optimized:
                return optimized + orders_without_coords
        
        # Nearest-neighbor fallback
        unvisited = orders_with_coords.copy()
        sequence = []
        
        # Start with nearest order to the origin if provided
        if start_coords and unvisited:
            start_lat, start_lng = start_coords
            nearest = min(
                unvisited,
                key=lambda order: haversine_distance(
                    start_lat,
                    start_lng,
                    order.get('latitude'),
                    order.get('longitude')
                )
            )
            unvisited.remove(nearest)
            sequence.append(nearest)
            current = nearest
        else:
            current = unvisited.pop(0)
            sequence.append(current)
        
        while unvisited:
            current_lat = current.get('latitude')
            current_lng = current.get('longitude')
            
            if not current_lat or not current_lng:
                # If current has no coordinates, just add remaining orders
                sequence.extend(unvisited)
                break
            
            # Find nearest unvisited order
            nearest = None
            nearest_distance = float('inf')
            
            for order in unvisited:
                order_lat = order.get('latitude')
                order_lng = order.get('longitude')
                
                if not order_lat or not order_lng:
                    continue
                
                distance = haversine_distance(current_lat, current_lng, order_lat, order_lng)
                if distance < nearest_distance:
                    nearest_distance = distance
                    nearest = order
            
            if nearest:
                unvisited.remove(nearest)
                sequence.append(nearest)
                current = nearest
            else:
                # No valid coordinates found, add remaining orders
                sequence.extend(unvisited)
                break
        
        return sequence + orders_without_coords
    
    def _get_route_color_circle_emoji(self, route_color: str) -> Optional[str]:
        """
        Map a route color (hex code) to a colored circle emoji.
        
        Args:
            route_color: Hex color code (e.g., "#1E90FF")
            
        Returns:
            Colored circle emoji or None if no match
        """
        if not route_color:
            return None
        
        # Normalize color to uppercase for comparison
        color_upper = route_color.upper()
        
        # Map hex colors to circle emojis
        # Route 1: blue (#1E90FF) -> 🔵
        # Route 2: green (#4CAF50) -> 🟢
        # Route 3: golden/yellow (#FFD700) -> 🟡
        # Route 4: fuchsia/purple (#FF00FF) -> 🟣
        # Route 5: brown (#8B4513) -> 🟤
        color_to_emoji = {
            '#1E90FF': '🔵',  # blue
            '#4CAF50': '🟢',  # green
            '#FFD700': '🟡',  # golden/yellow
            '#FF00FF': '🟣',  # fuchsia/purple
            '#8B4513': '🟤',  # brown
            '#FF6B35': '🟠',  # orange (route 6+)
            '#9B59B6': '🟣',  # purple (route 6+)
            '#00CED1': '🔵',  # teal -> blue
            '#FF1493': '🟣',  # deep pink -> purple
            '#32CD32': '🟢',  # lime green -> green
            '#FF8C00': '🟠',  # dark orange -> orange
            '#9370DB': '🟣',  # medium purple -> purple
            '#20B2AA': '🔵',  # light sea green -> blue
        }
        
        # Direct match
        if color_upper in color_to_emoji:
            return color_to_emoji[color_upper]
        
        # Approximate matching for other colors
        # Extract RGB values for approximate matching
        try:
            # Remove # if present
            hex_color = color_upper.lstrip('#')
            if len(hex_color) == 6:
                r = int(hex_color[0:2], 16)
                g = int(hex_color[2:4], 16)
                b = int(hex_color[4:6], 16)
                
                # Determine dominant color
                max_val = max(r, g, b)
                if max_val == 0:
                    return None
                
                # Calculate which color is dominant
                r_ratio = r / max_val
                g_ratio = g / max_val
                b_ratio = b / max_val
                
                # Map to closest circle emoji
                if r_ratio > 0.8 and g_ratio < 0.5 and b_ratio < 0.5:
                    return '🔴'  # Red
                elif r_ratio > 0.7 and g_ratio > 0.4 and b_ratio < 0.5:
                    return '🟠'  # Orange
                elif r_ratio > 0.7 and g_ratio > 0.7 and b_ratio < 0.5:
                    return '🟡'  # Yellow
                elif g_ratio > 0.7 and r_ratio < 0.5 and b_ratio < 0.5:
                    return '🟢'  # Green
                elif b_ratio > 0.7 and r_ratio < 0.5 and g_ratio < 0.5:
                    return '🔵'  # Blue
                elif r_ratio > 0.6 and b_ratio > 0.6 and g_ratio < 0.5:
                    return '🟣'  # Purple
                elif r_ratio > 0.5 and g_ratio < 0.4 and b_ratio < 0.3:
                    return '🟤'  # Brown
        except (ValueError, IndexError):
            pass
        
        # Default fallback
        return '🔵'  # Default to blue
    
    def _get_route_color(self, route_tag: str) -> Optional[str]:
        """
        Get the color for a route based on route number.
        
        Color scheme:
        - Rota 01: blue (#1E90FF)
        - Rota 02: green (#4CAF50)
        - Rota 03: golden (#FFD700)
        - Rota 04: fuchsia (#FF00FF)
        - Rota 05: brown (#8B4513)
        - Rota 06+: rotating colors (orange, purple, teal, etc.)
        
        Args:
            route_tag: Route tag (e.g., "rota-01", "rota-02")
            
        Returns:
            Hex color code or None if route_tag is invalid
        """
        if not route_tag or not isinstance(route_tag, str):
            return None
        
        # Extract route number from route_tag (e.g., "rota-01" -> 1)
        if route_tag.startswith('rota-'):
            try:
                route_num_str = route_tag.replace('rota-', '').strip()
                route_num = int(route_num_str)
            except (ValueError, AttributeError):
                return None
        else:
            return None
        
        # Color mapping for routes 1-5
        color_map = {
            1: '#1E90FF',  # blue
            2: '#4CAF50',  # green
            3: '#FFD700',  # golden
            4: '#FF00FF',  # fuchsia
            5: '#8B4513',  # brown
        }
        
        # Return specific color for routes 1-5
        if route_num in color_map:
            return color_map[route_num]
        
        # For routes 6+, use rotating colors
        extended_colors = [
            '#FF6B35',  # orange
            '#9B59B6',  # purple
            '#00CED1',  # teal
            '#FF1493',  # deep pink
            '#32CD32',  # lime green
            '#FF8C00',  # dark orange
            '#9370DB',  # medium purple
            '#20B2AA',  # light sea green
        ]
        
        # Cycle through extended colors (route 6 -> index 0, route 7 -> index 1, etc.)
        color_index = (route_num - 6) % len(extended_colors)
        return extended_colors[color_index]
    
    def _get_history_file_path(self) -> Path:
        """Get the path to the local delivery tags history file"""
        # Create data directory if it doesn't exist
        data_dir = Path(__file__).parent.parent.parent / "data" / "local_delivery"
        data_dir.mkdir(parents=True, exist_ok=True)
        return data_dir / "ld_tags_history.json"
    
    def _load_tags_history(self) -> Dict[str, List[str]]:
        """Load the history of orders with local delivery tags from local file"""
        history_file = self._get_history_file_path()
        if history_file.exists():
            try:
                with open(history_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                st.warning(f"Could not load tags history: {str(e)}")
                return {}
        return {}
    
    def _save_tags_history(self, history: Dict[str, List[str]]) -> None:
        """Save the history of orders with local delivery tags to local file"""
        history_file = self._get_history_file_path()
        try:
            with open(history_file, 'w', encoding='utf-8') as f:
                json.dump(history, f, indent=2, ensure_ascii=False)
        except Exception as e:
            st.warning(f"Could not save tags history: {str(e)}")
    
    def _add_to_tags_history(self, order_id: str, tags: List[str]) -> None:
        """Add an order and its local delivery tags to history"""
        history = self._load_tags_history()
        # Filter only local delivery tags (ld_rota-XX format)
        ld_tags = [tag for tag in tags if tag.startswith('ld_rota-')]
        if ld_tags:
            history[order_id] = ld_tags
            self._save_tags_history(history)
    
    def _remove_from_tags_history(self, order_ids: List[str]) -> None:
        """Remove orders from tags history"""
        history = self._load_tags_history()
        for order_id in order_ids:
            history.pop(order_id, None)
        self._save_tags_history(history)
    
    def _get_reentrega_cache_file_path(self) -> Path:
        """Get the path to the reentrega orders cache file"""
        data_dir = Path(__file__).parent.parent.parent / "data" / "local_delivery"
        data_dir.mkdir(parents=True, exist_ok=True)
        return data_dir / "ld_reentrega_cache.json"
    
    def _load_reentrega_cache(self) -> Dict[str, Dict[str, Any]]:
        """Load the cache of reentrega orders assigned to routes"""
        cache_file = self._get_reentrega_cache_file_path()
        if cache_file.exists():
            try:
                with open(cache_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                st.warning(f"Could not load reentrega cache: {str(e)}")
                return {}
        return {}
    
    def _save_reentrega_cache(self, cache: Dict[str, Dict[str, Any]]) -> None:
        """Save the cache of reentrega orders assigned to routes"""
        cache_file = self._get_reentrega_cache_file_path()
        try:
            with open(cache_file, 'w', encoding='utf-8') as f:
                json.dump(cache, f, indent=2, ensure_ascii=False)
        except Exception as e:
            st.warning(f"Could not save reentrega cache: {str(e)}")
    
    def _add_to_reentrega_cache(self, order_id: str, fulfillment_location: str, route_tag: str) -> None:
        """Add a reentrega order to the cache when assigned to a route"""
        cache = self._load_reentrega_cache()
        cache[order_id] = {
            'fulfillment_location': fulfillment_location,
            'route_tag': route_tag,
            'assigned_at': datetime.now().isoformat()
        }
        self._save_reentrega_cache(cache)
    
    def _remove_from_reentrega_cache(self, order_ids: List[str]) -> None:
        """Remove orders from reentrega cache"""
        cache = self._load_reentrega_cache()
        for order_id in order_ids:
            cache.pop(order_id, None)
        self._save_reentrega_cache(cache)

    def _get_committed_routes_cache_file_path(self) -> Path:
        """Get the path to the committed routes cache file"""
        data_dir = Path(__file__).parent.parent.parent / "data" / "local_delivery"
        data_dir.mkdir(parents=True, exist_ok=True)
        return data_dir / "ld_committed_routes_cache.json"

    def _load_committed_routes_cache(self) -> Dict[str, Any]:
        """Load committed routes cache from local file"""
        cache_file = self._get_committed_routes_cache_file_path()
        if cache_file.exists():
            try:
                with open(cache_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                st.warning(f"Could not load committed routes cache: {str(e)}")
                return {}
        return {}

    def _save_committed_routes_cache(self, cache: Dict[str, Any]) -> None:
        """Save committed routes cache to local file"""
        cache_file = self._get_committed_routes_cache_file_path()
        try:
            with open(cache_file, 'w', encoding='utf-8') as f:
                json.dump(cache, f, indent=2, ensure_ascii=False)
        except Exception as e:
            st.warning(f"Could not save committed routes cache: {str(e)}")

    def _calculate_committed_routes_summary(
        self,
        orders_data: List[Dict[str, Any]]
    ) -> Dict[str, Dict[str, Any]]:
        """Calculate committed routes summary from orders data."""
        route_summary: Dict[str, Dict[str, Any]] = {}
        for order in orders_data:
            route_tag = order.get('route_tag', '')
            if not route_tag:
                continue
            if route_tag not in route_summary:
                route_summary[route_tag] = {
                    'order_count': 0,
                    'shipping_total': 0.0,
                    'currency': order.get('shipping_currency', 'BRL')
                }
            route_summary[route_tag]['order_count'] += 1
            shipping_charge = order.get('shipping_charge', '0')
            try:
                shipping_amount = float(shipping_charge) if shipping_charge else 0.0
                route_summary[route_tag]['shipping_total'] += shipping_amount
            except (ValueError, TypeError):
                continue
        return route_summary

    def _update_committed_routes_cache(
        self,
        fulfillment_location: str,
        orders_data: List[Dict[str, Any]]
    ) -> None:
        """Update committed routes cache for current date and location."""
        today_key = date.today().isoformat()
        cache = self._load_committed_routes_cache()
        if today_key not in cache:
            cache[today_key] = {}
        cache[today_key][fulfillment_location] = {
            'routes': self._calculate_committed_routes_summary(orders_data)
        }
        self._save_committed_routes_cache(cache)

    def _get_committed_routes_summary(
        self,
        fulfillment_location: str
    ) -> Dict[str, Dict[str, Any]]:
        """Get committed routes summary for current date and location."""
        today_key = date.today().isoformat()
        cache = self._load_committed_routes_cache()
        location_summary = cache.get(today_key, {}).get(fulfillment_location, {})
        return location_summary.get('routes', {})
    
    async def _remove_order_tags(self, client: ShopifyGraphQLClient, order_id: str, tags_to_remove: List[str]) -> bool:
        """Remove specific tags from an order using GraphQL mutation"""
        if not order_id or not tags_to_remove:
            return False
        
        mutation = """
        mutation tagsRemove($id: ID!, $tags: [String!]!) {
          tagsRemove(id: $id, tags: $tags) {
            node {
              id
              ... on Order {
                tags
              }
            }
            userErrors {
              field
              message
            }
          }
        }
        """
        
        variables = {
            "id": order_id,
            "tags": tags_to_remove
        }
        
        try:
            result = await client.execute_query(mutation, variables)
            
            if not result:
                return False
            
            data = result.get('data', {})
            if not data:
                errors = result.get('errors', [])
                if errors:
                    error_messages = [err.get('message', 'Unknown error') for err in errors]
                    st.warning(f"GraphQL error removing tags from order {order_id}: {', '.join(error_messages)}")
                return False
            
            tags_remove = data.get('tagsRemove', {})
            if not tags_remove:
                return False
            
            user_errors = tags_remove.get('userErrors', [])
            
            if user_errors:
                error_messages = [err.get('message', 'Unknown error') for err in user_errors]
                st.warning(f"Error removing tags from order {order_id}: {', '.join(error_messages)}")
                return False
            
            return True
        except Exception as e:
            st.warning(f"Exception removing tags from order {order_id}: {str(e)}")
            return False
    
    async def _fetch_orders_by_ids(self, client: ShopifyGraphQLClient, order_ids: List[str]) -> Dict[str, Dict]:
        """Fetch orders by their IDs to get fulfillment location information"""
        if not order_ids:
            return {}
        
        # Shopify allows up to 250 nodes per query, so we need to batch
        orders_data = {}
        batch_size = 250
        
        for i in range(0, len(order_ids), batch_size):
            batch_ids = order_ids[i:i + batch_size]
            
            try:
                variables = {"ids": batch_ids}
                result = await client.execute_query(ORDERS_BY_IDS_QUERY, variables)
                
                if result and result.get('data'):
                    nodes = result.get('data', {}).get('nodes', [])
                    for node in nodes:
                        if node and node.get('id'):
                            orders_data[node['id']] = node
                
                # Small delay to avoid rate limiting
                await asyncio.sleep(0.1)
                
            except Exception as e:
                st.warning(f"Error fetching orders batch: {str(e)}")
                continue
        
        return orders_data
    
    def _get_fulfillment_location_from_order(self, order: Dict) -> Optional[str]:
        """Get fulfillment location for an order based on shipping address province"""
        shipping_address = order.get('shippingAddress', {})
        if not shipping_address:
            return None
        
        province = shipping_address.get('province', '')
        if not province:
            return None
        
        # Map province to fulfillment location
        fulfillment_location_name = self.PROVINCE_TO_LOCATION_MAP.get(province) or \
                                      self.PROVINCE_TO_LOCATION_MAP.get(province.upper())
        
        return fulfillment_location_name
    
    def _get_actual_fulfillment_location_from_order(self, order: Dict) -> Optional[str]:
        """Get the actual fulfillment location from order fulfillments (from Shopify)"""
        fulfillments = order.get('fulfillments', [])
        if not fulfillments:
            return None
        
        # Get the first fulfillment's location name
        for fulfillment in fulfillments:
            location = fulfillment.get('location', {})
            if location:
                location_name = location.get('name')
                if location_name:
                    return location_name
        
        return None
    
    def _is_order_allocated_to_different_location(self, order: Dict, mapped_location: Optional[str]) -> bool:
        """Check if order's actual fulfillment location differs from mapped location
        
        This identifies orders with shipment requests - e.g., orders destined to Ceará
        (mapped to Iguatemi Fortaleza) but actually fulfilled from a different location
        like CD Cajamar.
        """
        if not mapped_location:
            return False
        
        actual_location = self._get_actual_fulfillment_location_from_order(order)
        if not actual_location:
            return False
        
        # Compare actual location to mapped location
        # If they're different, the order is being allocated to a different fulfillment location
        # and needs a shipment request (e.g., Ceará orders should go to Iguatemi Fortaleza,
        # but if they come from CD Cajamar or another center, they need a shipment request)
        return actual_location != mapped_location
    
    def _count_shipment_requests(self, orders_data: List[Dict], fulfillment_location: str) -> int:
        """Count orders with shipment requests for a given fulfillment location
        
        This identifies orders that need shipment requests, such as:
        - Orders destined to Ceará (should go to Iguatemi Fortaleza) but actually
          fulfilled from a different location (e.g., CD Cajamar)
        - Orders to other provinces that are fulfilled from non-mapped locations
        
        Args:
            orders_data: List of processed order dictionaries
            fulfillment_location: Fulfillment location to filter by (or "All fulfillment locations")
            
        Returns:
            Count of orders with shipment requests
        """
        count = 0
        for order in orders_data:
            # Check if order is allocated to different location (needs shipment request)
            # For Ceará orders: if mapped to Iguatemi Fortaleza but actually from
            # a different fulfillment center, this will be True
            is_allocated = order.get('is_allocated_to_different_location', False)
            if not is_allocated:
                continue
            
            # Filter by fulfillment location if specified
            # For Ceará orders, fulfillment_location should be "Iguatemi Fortaleza"
            if fulfillment_location != "All fulfillment locations":
                order_location = order.get('fulfillment_location', '')
                if order_location != fulfillment_location:
                    continue
            
            count += 1
        
        return count
    
    async def _cleanup_tags_from_history(self, fulfillment_location_filter: str = "All fulfillment locations") -> Tuple[int, int]:
        """Remove local delivery tags from orders in history and update history
        
        Args:
            fulfillment_location_filter: Filter by fulfillment location. If "All fulfillment locations",
                                       cleans all orders. Otherwise, only cleans orders from that location.
        
        Returns:
            Tuple of (success_count, error_count)
        """
        history = self._load_tags_history()
        if not history:
            return 0, 0
        
        if not self.config:
            return 0, 0
        
        # If filtering by location, fetch orders to check their fulfillment location
        order_ids_to_check = list(history.keys())
        orders_by_location = {}
        
        if fulfillment_location_filter != "All fulfillment locations":
            async with ShopifyGraphQLClient() as client:
                orders_data = await self._fetch_orders_by_ids(client, order_ids_to_check)
                
                # Group orders by fulfillment location
                for order_id, order in orders_data.items():
                    fulfillment_location = self._get_fulfillment_location_from_order(order)
                    if fulfillment_location:
                        if fulfillment_location not in orders_by_location:
                            orders_by_location[fulfillment_location] = []
                        orders_by_location[fulfillment_location].append(order_id)
        
        success_count = 0
        error_count = 0
        orders_to_remove = []
        
        async with ShopifyGraphQLClient() as client:
            for order_id, tags in history.items():
                try:
                    if not order_id:
                        continue
                    
                    # Filter by fulfillment location if specified
                    if fulfillment_location_filter != "All fulfillment locations":
                        # Check if this order belongs to the selected fulfillment location
                        order_matches_location = False
                        for location, location_order_ids in orders_by_location.items():
                            if location == fulfillment_location_filter and order_id in location_order_ids:
                                order_matches_location = True
                                break
                        
                        if not order_matches_location:
                            # Skip this order - it doesn't match the selected fulfillment location
                            continue
                    
                    # Remove all local delivery tags for this order
                    result = await self._remove_order_tags(client, order_id, tags)
                    if result:
                        success_count += 1
                        orders_to_remove.append(order_id)
                    else:
                        error_count += 1
                    
                    # Small delay to avoid rate limiting
                    await asyncio.sleep(0.1)
                    
                except Exception as e:
                    error_count += 1
                    st.warning(f"Error cleaning up tags for order {order_id}: {str(e)}")
        
        # Remove successfully cleaned orders from history
        if orders_to_remove:
            self._remove_from_tags_history(orders_to_remove)
        
        return success_count, error_count
    
    async def _fetch_all_locations(self, client: ShopifyGraphQLClient) -> Tuple[List[str], List[Dict]]:
        """Fetch all locations directly from Shopify with their addresses"""
        try:
            variables = {"first": 250}  # Shopify allows up to 250 locations per query
            result = await client.execute_query(LOCATIONS_QUERY, variables)
            locations_data = result.get('data', {}).get('locations', {})
            edges = locations_data.get('edges', [])
            
            location_names = []
            locations_with_addresses = []
            
            for edge in edges:
                node = edge.get('node', {})
                location_name = node.get('name', '')
                address = node.get('address', {})
                
                if location_name:
                    location_names.append(location_name)
                    
                    # Store location with address for mapping
                    locations_with_addresses.append({
                        'id': node.get('id', ''),
                        'name': location_name,
                        'address': address
                    })
            
            return sorted(location_names), locations_with_addresses
        except Exception as e:
            st.warning(f"Could not fetch all locations from Shopify: {str(e)}")
            return [], []
    
    async def _fetch_shipping_methods_and_locations(self, client: ShopifyGraphQLClient, sample_size: int = 200) -> Tuple[List[str], List[str], List[str]]:
        """Fetch unique fulfillment statuses and fulfillment locations from orders"""
        try:
            # Fetch all locations directly from Shopify first
            all_locations, _ = await self._fetch_all_locations(client)
            all_locations_set = set(all_locations)
            
            # Also add mapped fulfillment locations from province mapping
            for location_name in self.PROVINCE_TO_LOCATION_MAP.values():
                all_locations_set.add(location_name)
            
            # Fetch a sample of orders to get unique statuses
            variables = {
                "first": min(sample_size, 250),
                "after": None,
                "query": None
            }
            
            result = await client.execute_query(ORDERS_WITH_COORDINATES_QUERY, variables)
            orders_data = result.get('data', {}).get('orders', {})
            edges = orders_data.get('edges', [])
            
            fulfillment_statuses = set()
            fulfillment_locations = set(all_locations_set)  # Start with all locations from Shopify and mapping
            
            for edge in edges:
                node = edge.get('node', {})
                
                # Process all orders (no shipping method filter - we filter by LOCAL tag instead)
                
                # Get fulfillment status
                status = node.get('displayFulfillmentStatus', '')
                if status:
                    fulfillment_statuses.add(status)
                
                # Get fulfillment locations from fulfillments (may have locations not in the main locations list)
                fulfillments = node.get('fulfillments', [])
                for fulfillment in fulfillments:
                    # Get fulfillment location
                    location = fulfillment.get('location')
                    if location:
                        location_name = location.get('name', '')
                        if location_name:
                            fulfillment_locations.add(location_name)
                    
            return [], sorted(list(fulfillment_statuses)), sorted(list(fulfillment_locations))
        except Exception as e:
            st.warning(f"Could not fetch fulfillment statuses and locations: {str(e)}")
            return [], [], []
    
    def render_delivery_map(self):
        """Render the delivery address mapping interface"""
        # Get context info from session state
        context_info = st.session_state.get('context_info', LOCAL_DELIVERY_CONTEXT)
        
        # Display description before main content
        # Handle both processed (string) and unprocessed (dict) context
        description = context_info.get('description', '')
        if isinstance(description, dict):
            # Context not processed yet - select language
            current_lang = get_current_language()
        
        # Load available options from Shopify if not already loaded
        if not self.available_fulfillment_locations:
            if self.config:
                with st.spinner("Loading available options..."):
                    try:
                        loop = asyncio.new_event_loop()
                        asyncio.set_event_loop(loop)
                        try:
                            async def load_options():
                                async with ShopifyGraphQLClient() as client:
                                    methods, statuses, locations = await self._fetch_shipping_methods_and_locations(client)
                                    return methods, statuses, locations
                            
                            methods, statuses, locations = loop.run_until_complete(load_options())
                            self.available_fulfillment_statuses = statuses
                            self.available_fulfillment_locations = locations
                        finally:
                            loop.close()
                    except Exception as e:
                        st.warning(f"Could not load options from Shopify: {str(e)}")
                        # Use defaults if fetch fails
                        if not self.available_fulfillment_statuses:
                            self.available_fulfillment_statuses = ["UNFULFILLED", "PARTIAL", "FULFILLED", "RESTOCKED", "PENDING_FULFILLMENT", "OPEN", "IN_PROGRESS", "SCHEDULED"]
                        if not self.available_fulfillment_locations:
                            self.available_fulfillment_locations = []
        
        # Fulfillment status filter - hardcoded to exclude FULFILLED orders
        # Show all statuses except FULFILLED (filter is applied in backend, UI shows normally)
        all_statuses = self.available_fulfillment_statuses if self.available_fulfillment_statuses else ["UNFULFILLED", "PARTIAL", "RESTOCKED", "PENDING_FULFILLMENT", "OPEN", "IN_PROGRESS", "SCHEDULED"]
        # Remove FULFILLED from options if present
        status_options = [s for s in all_statuses if s.upper() != "FULFILLED"]
        
        # Use all non-fulfilled statuses for filtering (hardcoded in backend)
        fulfillment_statuses = status_options.copy() if status_options else ["UNFULFILLED", "PARTIAL", "RESTOCKED", "PENDING_FULFILLMENT", "OPEN", "IN_PROGRESS", "SCHEDULED"]
        
        # Default date filter: D-1 (yesterday to today)
        today = date.today()
        default_start_date = today - timedelta(days=1)
        
        # Initialize date filter (end date is always today)
        if 'delivery_start_date' not in st.session_state:
            st.session_state.delivery_start_date = default_start_date
        
        # Main layout: Column 1 (33.3%) and Column 2 (66.7%)
        col1, col2 = st.columns([1, 2])
        
        with col1:
            # Display shipment requests section at the top of col1 (after description, before controls)
            self._display_shipment_requests_section_at_top()
        
        # Check if we should show main UI (controls, map)
        should_show_main_ui = self._should_show_main_ui()
        
        if not should_show_main_ui:
            # Don't show main UI if shipment requests are being processed
            # Just show the shipment requests section
            return
        
        # Main UI elements (controls, buttons, map) - only shown if should_show_main_ui is True
        with col1:
            # Fulfillment location and start date in same row with equal width
            filter_col1, filter_col2 = st.columns([1, 1])
            
            with filter_col1:
                # Fulfillment location filter - only show mapped locations
                mapped_locations = list(set(self.PROVINCE_TO_LOCATION_MAP.values()))
                location_options = ["All fulfillment locations"] + sorted(mapped_locations)
                
                fulfillment_location_filter = st.selectbox(
                    "Fulfillment location",
                    options=location_options,
                    key="fulfillment_location_filter",
                    help="Filter by fulfillment location (where orders are fulfilled from)"
                )
            
            with filter_col2:
                # Date filter - only start date (always includes orders up to today)
                start_date = st.date_input(
                    "Start date",
                    value=st.session_state.delivery_start_date,
                    key="delivery_start_date_input",
                    help="Start date for order filtering. Orders up to today will be included."
                )
                st.session_state.delivery_start_date = start_date
            
            # Delivery promisse and applied filters in same row
            promise_col1, promise_col2 = st.columns([1, 1])
            
            with promise_col1:
                if 'delivery_promise' not in st.session_state:
                    st.session_state.delivery_promise = "Next day"
                delivery_promise = st.selectbox(
                    "Delivery promisse",
                    options=["Next day", "Day +2", "Day +3"],
                    key="delivery_promise_selectbox"
                )
                st.session_state.delivery_promise = delivery_promise
            
            with promise_col2:
                # Applied filters - changed to expander
                with st.expander("Applied filters", expanded=False):
                    # Build filter content with each criteria on a separate line
                    filter_lines = []
                    filter_lines.append("tagged with: LOCAL")
                    filter_lines.append("Fulfillment status: All except FULFILLED")
                    filter_lines.append(f"Date range: {start_date.strftime('%Y/%m/%d')} to today")
                    filter_lines.append(f"Delivery promisse: {delivery_promise}")
                    
                    # Pre-sale tag filter: show dynamic selection if orders are loaded
                    if 'delivery_orders_data' in st.session_state and st.session_state.delivery_orders_data:
                        presale_tags = self._extract_presale_tags_from_orders(st.session_state.delivery_orders_data)
                        if presale_tags:
                            selected_tags = st.session_state.get('selected_presale_tags', [])
                            if selected_tags:
                                filter_lines.append(f"Include pre-sale tags: {', '.join(selected_tags)}")
                            else:
                                filter_lines.append("Exclude all pre-sale tags (tags starting with 'pre-venda')")
                        else:
                            # No pre-sale tags found in current orders
                            pass  # Don't show pre-sale filter if no pre-sale tags exist
                    else:
                        # Orders not loaded yet, show default message
                        filter_lines.append("Pre-sale tags: User-selectable (load orders to see options)")
                    
                    # Display each criteria on a separate line
                    filter_content = "\n\n".join(filter_lines)
                    st.markdown(filter_content)
            
            # Check if filters have changed - if so, reset state to fetch new orders
            # Only reset if orders have been loaded and confirmed (presale_tags_confirmed exists)
            prev_location = st.session_state.get('_prev_fulfillment_location_filter', None)
            prev_start_date = st.session_state.get('_prev_delivery_start_date', None)
            prev_promise = st.session_state.get('_prev_delivery_promise', None)
            
            filters_changed = (
                prev_location is not None and prev_location != fulfillment_location_filter or
                prev_start_date is not None and prev_start_date != start_date or
                prev_promise is not None and prev_promise != delivery_promise
            )
            
            # Store current filter values for next comparison
            st.session_state['_prev_fulfillment_location_filter'] = fulfillment_location_filter
            st.session_state['_prev_delivery_start_date'] = start_date
            st.session_state['_prev_delivery_promise'] = delivery_promise
            
            # If filters changed and orders were previously loaded and confirmed, reset state
            # This ensures we only reset after orders have been loaded and confirmed
            orders_loaded = 'delivery_orders_data' in st.session_state and st.session_state.delivery_orders_data
            
            if filters_changed and orders_loaded:
                # Check if orders were confirmed (either via presale confirmation or no presale tags)
                orders_confirmed = False
                if 'presale_tags_confirmed' in st.session_state:
                    orders_confirmed = st.session_state.presale_tags_confirmed
                else:
                    # If no presale_tags_confirmed flag exists, check if there are presale tags
                    # If there are no presale tags, orders are automatically "confirmed"
                    presale_tags = self._extract_presale_tags_from_orders(st.session_state.delivery_orders_data)
                    orders_confirmed = len(presale_tags) == 0  # No presale tags = auto-confirmed
                
                if orders_confirmed:
                    # Reset all order-related state to force fresh fetch
                    if 'delivery_orders_data' in st.session_state:
                        del st.session_state.delivery_orders_data
                    if 'presale_tags_confirmed' in st.session_state:
                        del st.session_state.presale_tags_confirmed
                    if 'selected_presale_tags' in st.session_state:
                        del st.session_state.selected_presale_tags
                    if 'selected_orders' in st.session_state:
                        st.session_state.selected_orders = set()
                    # Reset map state as well
                    if 'map_center' in st.session_state:
                        del st.session_state.map_center
                    if 'map_zoom' in st.session_state:
                        del st.session_state.map_zoom
                    if 'map_container_created' in st.session_state:
                        del st.session_state.map_container_created
                    # Note: We don't reset delivery_routes as those are persistent across filter changes
            
        # Apply shared button styles
        apply_primary_button_styles()
        
        # Column 1 continues with buttons, pre-sale multiselect, and Orders section
        with col1:
            # Buttons side by side, each filling 50% of the column
            btn_col1, btn_col2 = st.columns(2)
            
            with btn_col1:
                if st.button("🧹 Clear tags", type="secondary", use_container_width=True, key="clear_tags_button"):
                    # Clean up tags from history, filtered by fulfillment location
                    # Get current fulfillment location filter
                    current_location_filter = st.session_state.get('fulfillment_location_filter', 'All fulfillment locations')
                    
                    with st.spinner("Removing tags..."):
                        try:
                            loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(loop)
                            try:
                                success_count, error_count = loop.run_until_complete(
                                    self._cleanup_tags_from_history(fulfillment_location_filter=current_location_filter)
                                )
                                if success_count > 0:
                                    location_msg = f" from {current_location_filter}" if current_location_filter != "All fulfillment locations" else ""
                                    st.success(f"✅ Removed local delivery tags from {success_count} order(s){location_msg}")
                                elif error_count > 0:
                                    st.warning(f"⚠️ Failed to remove tags from {error_count} order(s)")
                                else:
                                    location_msg = f" for {current_location_filter}" if current_location_filter != "All fulfillment locations" else ""
                                    st.info(f"ℹ️ No orders found in history to clean up{location_msg}")
                            finally:
                                loop.close()
                        except Exception as e:
                            st.warning(f"⚠️ Could not clean up tags: {str(e)}")
            
            with btn_col2:
                if st.button("🗺️ Load orders", type="primary", use_container_width=True, key="load_orders_button"):
                    # Load new orders
                    # fulfillment_statuses is now hardcoded (all except FULFILLED)
                    # No max_orders limit - fetch all matching orders
                    # Convert date objects to datetime for the query
                    start_date_dt = datetime.combine(st.session_state.delivery_start_date, datetime.min.time())
                    # End date is always today
                    today = date.today()
                    end_date_dt = datetime.combine(today, datetime.max.time())
                    
                    # Reset presale confirmation when loading new orders
                    if 'presale_tags_confirmed' in st.session_state:
                        del st.session_state.presale_tags_confirmed
                    
                    self._fetch_and_display_orders(
                        fulfillment_statuses=fulfillment_statuses,  # This is now all non-fulfilled statuses
                        fulfillment_location_filter=fulfillment_location_filter,
                        start_date=start_date_dt,
                        end_date=end_date_dt
                    )
            
            # Check if orders are loaded and extract pre-sale tags
            if 'delivery_orders_data' in st.session_state and st.session_state.delivery_orders_data:
                presale_tags = self._extract_presale_tags_from_orders(st.session_state.delivery_orders_data)
                
                # If pre-sale tags exist, show expander with toggles and confirm button
                if presale_tags:
                    # Initialize session state for selected pre-sale tags if not exists
                    if 'selected_presale_tags' not in st.session_state:
                        st.session_state.selected_presale_tags = []
                    
                    # Initialize confirmation state if not exists
                    if 'presale_tags_confirmed' not in st.session_state:
                        st.session_state.presale_tags_confirmed = False
                    
                    with st.expander("There are unfulfilled pre-sale orders.", expanded=False):
                        st.caption("Select which tags to include in routes:")
                        
                        selected_presale_tags = []
                        for tag in presale_tags:
                            checkbox_key = f"presale_tag_toggle_{tag}"
                            is_checked = st.checkbox(
                                tag,
                                value=tag in st.session_state.selected_presale_tags,
                                key=checkbox_key
                            )
                            if is_checked:
                                selected_presale_tags.append(tag)
                        
                        st.session_state.selected_presale_tags = selected_presale_tags
                        
                        if st.button("Confirm", type="primary", use_container_width=True, key="confirm_presale_tags"):
                            st.session_state.presale_tags_confirmed = True
                            st.rerun()
        
        # Display map and orders if orders are loaded, or show error messages in map column
        # Only show if main UI should be displayed
        if 'delivery_orders_data' in st.session_state and st.session_state.delivery_orders_data:
            # Get current fulfillment location filter from session state
            fulfillment_location_filter = st.session_state.get('fulfillment_location_filter', 'All fulfillment locations')
            
            # Apply pre-sale filtering only to Orders to assign list (default excludes pre-sale)
            presale_tags = self._extract_presale_tags_from_orders(st.session_state.delivery_orders_data)
            selected_presale_tags = st.session_state.get('selected_presale_tags', [])
            presale_confirmed = st.session_state.get('presale_tags_confirmed', False)
            
            def should_include_in_orders_list(order: Dict[str, Any]) -> bool:
                order_tags = order.get('tags', [])
                if isinstance(order_tags, str):
                    order_tags = [tag.strip() for tag in order_tags.split(',') if tag.strip()]
                elif not isinstance(order_tags, list):
                    order_tags = []
                
                order_presale_tags = [tag for tag in order_tags if self._is_presale_tag(tag)]
                if not order_presale_tags:
                    return True
                if not presale_confirmed:
                    return False
                if not selected_presale_tags:
                    return False
                return any(tag in selected_presale_tags for tag in order_presale_tags)
            
            unassigned_orders_for_display = [
                order for order in st.session_state.delivery_orders_data
                if not order.get('route_tag', '') and should_include_in_orders_list(order)
            ]
            filtered_orders_for_map = [
                order for order in st.session_state.delivery_orders_data
                if should_include_in_orders_list(order)
            ]
            
            # Display orders selection in column 1 and map in column 2
            with col1:
                self._display_orders_selection(unassigned_orders_for_display)
            with col2:
                # Show only orders that pass pre-sale filters on map
                self._display_orders_map(filtered_orders_for_map, fulfillment_location_filter)
            
            # Display order list below columns (full width) - show all orders
            self._display_orders_table(st.session_state.delivery_orders_data)
        elif should_show_main_ui and 'no_orders_warning' in st.session_state:
            # Display error messages in map column (col2) when no orders found
            with col2:
                # Display warning or error message
                if st.session_state.no_orders_warning.startswith("❌"):
                    st.error(st.session_state.no_orders_warning)
                else:
                    st.warning(st.session_state.no_orders_warning)
                
                # Show error details if available (from exception)
                if st.session_state.get('no_orders_error_details'):
                    with st.expander("Error Details", expanded=False):
                        st.code(st.session_state.no_orders_error_details)
                
                # Show debug statistics if available
                if st.session_state.get('no_orders_debug_stats'):
                    with st.expander("🔍 Debug Statistics", expanded=True):
                        st.text(st.session_state.no_orders_debug_stats)
                
                # Only show common issues if it's not an error (i.e., it's a warning about no orders found)
                if not st.session_state.no_orders_warning.startswith("❌"):
                    st.info("💡 **If you believe there should be orders to fulfill, check these conditions and try again:**")
                    st.markdown("""
                    - **Shipping method**: Ensure orders have 'local delivery' in shipping method name (case-insensitive)
                    - **Fulfillment status**: Check if filter matches order status exactly (e.g., 'UNFULFILLED' vs 'Unfulfilled')
                    - **Coordinates**: Orders need valid coordinates or complete addresses for geocoding
                    - **Fulfillment location**: If filtering by location, unfulfilled orders should pass this filter
                    
                    **Tip**: Try setting fulfillment status filter to "All" to see if status matching is the issue.
                    """)
        
        # Shipment requests section is now displayed at the top (before controls)
        
    
    def _fetch_and_display_orders(
        self,
        fulfillment_statuses: List[str],
        fulfillment_location_filter: str,
        start_date: datetime,
        end_date: datetime
    ):
        """Fetch orders from Shopify and prepare for mapping"""
        
        if not self.config:
            st.error("Shopify configuration not found. Please configure your Shopify credentials.")
            return
        
        # Show loading spinner centered below button columns
        
        with st.spinner("Fetching orders..."):
            try:
                # Build query filters
                query_filters = []
                
                # Date filter - always include orders up to today
                today = date.today()
                query_filters.append(f"created_at:>={start_date.isoformat()}")
                query_filters.append(f"created_at:<={today.isoformat()}")
                
                # Note: Fulfillment location filtering will be done in post-processing
                # as Shopify GraphQL doesn't support filtering by fulfillment location directly
                
                query_string = " AND ".join(query_filters) if query_filters else None
                
                # Fetch orders
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                
                try:
                    async def fetch_orders():
                        async with ShopifyGraphQLClient() as client:
                            all_orders = []
                            cursor = None
                            page_count = 0
                            page_size = 50  # Fetch 50 orders per page
                            
                            while True:
                                variables = {
                                    "first": page_size,
                                    "after": cursor,
                                    "query": query_string
                                }
                                
                                result = await client.execute_query(ORDERS_WITH_COORDINATES_QUERY, variables)
                                
                                orders_data = result.get('data', {}).get('orders', {})
                                edges = orders_data.get('edges', [])
                                
                                if not edges:
                                    break
                                
                                orders_batch = [edge['node'] for edge in edges]
                                all_orders.extend(orders_batch)
                                
                                page_info = orders_data.get('pageInfo', {})
                                if not page_info.get('hasNextPage', False):
                                    break
                                
                                cursor = page_info.get('endCursor')
                                page_count += 1
                            
                            return all_orders
                    
                    # Fetch orders
                    orders = loop.run_until_complete(fetch_orders())
                    
                finally:
                    loop.close()
                
                # Process and filter orders with geocoding
                debug_info = {'stats': None}
                
                def geocode_progress(message):
                    # Store debug stats but don't display progress messages
                    if 'Debug:' in message:
                        debug_info['stats'] = message
                
                # Process orders (returns tuple: processed_orders, future_dated_orders)
                processed_orders, future_dated_orders = self._process_orders(
                    orders,
                    fulfillment_statuses,
                    fulfillment_location_filter,
                    progress_callback=geocode_progress
                )
                
                # Store future-dated orders in session state for display
                st.session_state.future_dated_orders = future_dated_orders
                
                # Remove ld_reentrega tags from delivered orders (async)
                orders_to_remove_tag = [
                    order['order_id'] for order in processed_orders 
                    if order.get('should_remove_reentrega_tag', False)
                ]
                if orders_to_remove_tag:
                    async def remove_tags():
                        async with ShopifyGraphQLClient() as client:
                            for order_id in orders_to_remove_tag:
                                await self._remove_order_tags(client, order_id, ['ld_reentrega'])
                    
                    # Run tag removal asynchronously (don't block UI)
                    try:
                        loop = asyncio.new_event_loop()
                        asyncio.set_event_loop(loop)
                        loop.run_until_complete(remove_tags())
                        loop.close()
                    except Exception as e:
                        st.warning(f"Could not remove reentrega tags: {str(e)}")
                
                # Store in session state
                st.session_state.delivery_orders_data = processed_orders
                # Future-dated orders are already stored in session state by _process_orders
                
                # Clear future-dated orders if no orders were processed (to avoid stale data)
                if len(processed_orders) == 0 and 'future_dated_orders' in st.session_state:
                    st.session_state.future_dated_orders = []
                
                if len(processed_orders) == 0:
                    # Store error messages in session state to display in col2 (map column)
                    total_orders = len(orders) if 'orders' in locals() else 0
                    st.session_state.no_orders_warning = f"⚠️ No orders found with valid coordinates after filtering. Processed {total_orders} orders from Shopify."
                    st.session_state.no_orders_debug_stats = debug_info['stats'] if debug_info['stats'] else None
                else:
                    # Clear error messages if orders were found
                    if 'no_orders_warning' in st.session_state:
                        del st.session_state.no_orders_warning
                    if 'no_orders_debug_stats' in st.session_state:
                        del st.session_state.no_orders_debug_stats
                
            except Exception as e:
                # Store error in session state to display in col2 (map column)
                import traceback
                error_details = traceback.format_exc()
                st.session_state.no_orders_warning = f"❌ Error fetching orders: {str(e)}"
                st.session_state.no_orders_error_details = error_details
                # Clear orders data if it exists
                if 'delivery_orders_data' in st.session_state:
                    st.session_state.delivery_orders_data = []
    
    def _format_customer_name(self, name: str) -> str:
        """
        Format customer name by:
        1. Removing Brazilian prepositions (de, do, da, dos, das, e)
        2. Using initials for middle names when name has more than 2 words
        3. Applying Title case
        
        Args:
            name: Raw customer name string
            
        Returns:
            Formatted customer name
        """
        if not name or not name.strip():
            return name
        
        # List of Brazilian prepositions to remove (can be extended later)
        prepositions = ['de', 'do', 'da', 'dos', 'das', 'e']
        
        # Split name into words and remove prepositions
        words = name.strip().split()
        filtered_words = []
        
        for word in words:
            # Check if word is a preposition (case-insensitive)
            # Only remove if it's between spaces (not at start or end, or if it's in the middle)
            word_lower = word.lower().strip()
            if word_lower in prepositions:
                # Skip this preposition
                continue
            filtered_words.append(word)
        
        # If no words remain after filtering, return original name
        if not filtered_words:
            return name.strip().title()
        
        # If 2 words or less, just apply Title case
        if len(filtered_words) <= 2:
            return ' '.join(filtered_words).title()
        
        # If more than 2 words, use initials for middle names
        # First name: keep full
        # Middle names: use initials
        # Last name: keep full
        formatted_parts = [filtered_words[0].title()]  # First name
        
        # Middle names (all except first and last)
        for word in filtered_words[1:-1]:
            if word:
                # Get first letter and capitalize
                initial = word[0].upper()
                formatted_parts.append(initial)
        
        # Last name: keep full
        formatted_parts.append(filtered_words[-1].title())
        
        return ' '.join(formatted_parts)
    
    def _parse_date_tag(self, tag: str) -> Optional[date]:
        """Parse a tag to check if it contains a date in DD/MM/YYYY format
        
        Args:
            tag: Tag string to parse
            
        Returns:
            date object if tag contains a valid date, None otherwise
        """
        import re
        from datetime import datetime
        
        # Try to match DD/MM/YYYY or DD-MM-YYYY format
        date_patterns = [
            r'(\d{2})/(\d{2})/(\d{4})',  # DD/MM/YYYY
            r'(\d{2})-(\d{2})-(\d{4})',  # DD-MM-YYYY
            r'(\d{1,2})/(\d{1,2})/(\d{4})',  # D/M/YYYY or DD/MM/YYYY
        ]
        
        for pattern in date_patterns:
            match = re.search(pattern, tag)
            if match:
                try:
                    day, month, year = match.groups()
                    parsed_date = datetime(int(year), int(month), int(day)).date()
                    return parsed_date
                except (ValueError, TypeError):
                    continue
        
        return None
    
    def _has_future_date_tag(self, tags: List[str]) -> bool:
        """Check if order has a tag with a future date
        
        Args:
            tags: List of order tags
            
        Returns:
            True if order has a tag with a future date, False otherwise
        """
        today = date.today()
        
        for tag in tags:
            tag_date = self._parse_date_tag(tag)
            if tag_date and tag_date > today:
                return True
        
        return False
    
    def _get_future_date_from_tags(self, tags: List[str]) -> Optional[date]:
        """Get the future date from order tags if present
        
        Args:
            tags: List of order tags
            
        Returns:
            date object if order has a tag with a future date, None otherwise
        """
        today = date.today()
        
        for tag in tags:
            tag_date = self._parse_date_tag(tag)
            if tag_date and tag_date > today:
                return tag_date
        
        return None
    
    def _process_orders(
        self,
        orders: List[Dict],
        fulfillment_statuses: List[str],
        fulfillment_location_filter: str,
        progress_callback=None
    ) -> Tuple[List[Dict], List[Dict]]:
        """Process and filter orders based on criteria, with geocoding fallback
        
        Returns:
            Tuple of (processed_orders, future_dated_orders)
            - processed_orders: Orders to display on map and in selection lists
            - future_dated_orders: Orders with future date tags (to display separately)
        """
        processed = []
        future_dated_orders = []  # Orders with future date tags
        geocoded_count = 0
        tags_history = self._load_tags_history()
        debug_stats = {
            'total': len(orders),
            'no_shipping_address': 0,
            'shipping_method_filtered': 0,
            'cancelled_filtered': 0,
            'presale_filtered': 0,
            'fulfillment_status_filtered': 0,
            'location_filtered': 0,
            'date_tag_filtered': 0,
            'no_coordinates': 0,
            'passed_all_filters': 0
        }
        
        for idx, order in enumerate(orders):
            shipping_address = order.get('shippingAddress')
            
            # Skip if no shipping address
            if not shipping_address:
                debug_stats['no_shipping_address'] += 1
                continue
            
            # Check tags early to identify future-dated orders before geocoding
            tags = order.get('tags', [])
            if isinstance(tags, str):
                tags = [tag.strip() for tag in tags.split(',') if tag.strip()]
            elif not isinstance(tags, list):
                tags = []
            
            # Check if order has LOCAL tag (case-insensitive)
            has_local_tag = False
            for tag in tags:
                if tag.upper() == 'LOCAL':
                    has_local_tag = True
                    break
            
            if not has_local_tag:
                debug_stats['shipping_method_filtered'] += 1
                continue
            
            # Check for future date tags BEFORE geocoding to avoid unnecessary work
            # Orders tagged with exact dates should be collected separately
            # They will be displayed below "Orders due tomorrow" but not on map or in selection lists
            future_date = self._get_future_date_from_tags(tags)
            if future_date:
                # Determine fulfillment location for filtering/display
                fulfillment_location_name = self._get_fulfillment_location_from_order(order)
                if not fulfillment_location_name:
                    debug_stats['location_filtered'] += 1
                    continue
                
                # When a specific location is selected, only include orders for that location
                if fulfillment_location_filter != "All fulfillment locations":
                    if fulfillment_location_name != fulfillment_location_filter:
                        debug_stats['location_filtered'] += 1
                        continue
                
                # Collect this order for separate display (not for map or selection)
                # Skip geocoding since these orders won't appear on the map
                order_data = {
                    'order_id': order.get('id'),
                    'order_name': order.get('name', ''),
                    'customer_name': self._format_customer_name(shipping_address.get('name', '')),
                    'future_date': future_date,
                    'fulfillment_location': fulfillment_location_name,
                    'tags': tags,
                    'created_at': order.get('createdAt', '')
                }
                future_dated_orders.append(order_data)
                debug_stats['date_tag_filtered'] += 1
                continue  # Skip rest of processing including geocoding
            
            # Get coordinates from shipping address using shared utility
            lat, lng = extract_coordinates_from_shipping_address(shipping_address)
            coordinates_valid = (lat is not None and lng is not None)
            
            # If coordinates are missing or invalid, geocode the address
            # Note: Unfulfilled orders often don't have coordinates until fulfillment
            # So we must geocode them from the address
            if not coordinates_valid:
                # Prepare address parts for geocoding
                # Don't include invalid coordinates in address_parts
                address_parts = {
                    'address1': shipping_address.get('address1', ''),
                    'address2': shipping_address.get('address2', ''),
                    'city': shipping_address.get('city', ''),
                    'province': shipping_address.get('province', ''),
                    'country': shipping_address.get('country', ''),
                    'zip': shipping_address.get('zip', '')
                }
                
                # Check if we have minimum required address info for geocoding
                has_minimum_address = (
                    address_parts.get('address1') or 
                    address_parts.get('city') or 
                    address_parts.get('zip')
                )
                
                if not has_minimum_address:
                    # Skip orders without enough address info to geocode
                    debug_stats['no_coordinates'] += 1
                    if progress_callback and (idx + 1) % 10 == 0:
                        progress_callback(f"Processing... {idx + 1}/{len(orders)} orders (insufficient address info)")
                    continue
                
                # Geocode the address
                try:
                    geocoded_lat, geocoded_lng = self.geocoding_service.geocode_address(address_parts)
                    
                    if geocoded_lat and geocoded_lng:
                        try:
                            lat = float(geocoded_lat)
                            lng = float(geocoded_lng)
                            # Validate geocoded coordinates
                            if -90 <= lat <= 90 and -180 <= lng <= 180:
                                coordinates_valid = True
                            geocoded_count += 1
                            
                            if progress_callback and (idx + 1) % 10 == 0:  # Update every 10 orders
                                progress_callback(f"Geocoding addresses... {geocoded_count} geocoded, {idx + 1}/{len(orders)} processed")
                        except (ValueError, TypeError) as e:
                            # Failed to convert geocoded coordinates
                            debug_stats['no_coordinates'] += 1
                            if progress_callback and (idx + 1) % 10 == 0:
                                progress_callback(f"Processing... {idx + 1}/{len(orders)} orders (coordinate conversion error)")
                            continue
                    else:
                        # Geocoding returned no results
                        debug_stats['no_coordinates'] += 1
                        if progress_callback and (idx + 1) % 10 == 0:
                            progress_callback(f"Processing... {idx + 1}/{len(orders)} orders (geocoding returned no results)")
                        continue
                except Exception as e:
                    # Log error but continue processing
                    debug_stats['no_coordinates'] += 1
                    if progress_callback and (idx + 1) % 10 == 0:
                        progress_callback(f"Processing... {idx + 1}/{len(orders)} orders (geocoding error: {str(e)[:50]})")
                    continue
            
            # Tags are already extracted and LOCAL tag is already checked earlier (before geocoding)
            # Future date tags are also already checked earlier
            # Continue with remaining filters
            # Orders with pre-sale tags are included here and filtered later based on user selection
            
            # Filter out cancelled orders (after tag check, before fulfillment status)
            cancelled_at = order.get('cancelledAt')
            display_financial_status = order.get('displayFinancialStatus', '')
            
            # Filter out orders with cancelledAt set (not null)
            if cancelled_at is not None:
                debug_stats['cancelled_filtered'] += 1
                continue
            
            # Filter out orders with financial status indicating cancellation
            # Common cancellation statuses: VOIDED, REFUNDED, PARTIALLY_REFUNDED
            if display_financial_status:
                financial_status_upper = display_financial_status.upper()
                cancelled_statuses = ['VOIDED', 'REFUNDED', 'PARTIALLY_REFUNDED']
                if financial_status_upper in cancelled_statuses:
                    debug_stats['cancelled_filtered'] += 1
                    continue
            
            # Filter by fulfillment status (after tag check)
            # Exclude FULFILLED orders, EXCEPT those with ld_reentrega or ld_devolucao tags
            # We allow all other statuses (including empty/None) to avoid filtering out valid orders
            # that may have status format mismatches or missing status values
            fulfillment_status = order.get('displayFulfillmentStatus', '')
            fulfillment_status_upper = fulfillment_status.upper() if fulfillment_status else ''
            
            # Check if order has delivery issues that require inclusion even if fulfilled
            has_devolucao_tag = 'ld_devolucao' in tags
            has_reentrega_tag = 'ld_reentrega' in tags
            
            # Exclude FULFILLED orders, unless they have delivery issues
            if fulfillment_status_upper == "FULFILLED":
                if not (has_devolucao_tag or has_reentrega_tag):
                    # Fulfilled order without delivery issues - exclude it
                    debug_stats['fulfillment_status_filtered'] += 1
                    continue
                # Fulfilled order with delivery issues - include it
            
            # Note: Removed strict fulfillment_statuses whitelist matching to fix filtering issue
            # The main requirement is to exclude FULFILLED orders, which is handled above
            # All other orders (including those with empty/missing status) are included
            
            # Filter by province (replaces fulfillment location filter)
            # Map province to fulfillment location in background
            shipping_address = order.get('shippingAddress', {})
            province = shipping_address.get('province', '')
            
            # Get the fulfillment location associated with this province
            # Orders to Ceará/CE are mapped to Iguatemi Fortaleza
            # Orders to Pernambuco/PE are mapped to Shopping Recife
            # Orders to Rio de Janeiro/RJ are mapped to RioSul
            # Orders to São Paulo/SP are mapped to Shops Jardins
            fulfillment_location_name = self.PROVINCE_TO_LOCATION_MAP.get(province) or \
                                      self.PROVINCE_TO_LOCATION_MAP.get(province.upper())
            
            # If no mapping found, skip this order (not a supported province)
            if not fulfillment_location_name:
                debug_stats['location_filtered'] += 1
                continue
            
            # When a specific location is selected, only include orders from provinces mapped to that location
            if fulfillment_location_filter != "All fulfillment locations":
                # Check if the province's mapped location matches the selected filter
                if fulfillment_location_name != fulfillment_location_filter:
                    debug_stats['location_filtered'] += 1
                    continue
            
            # Final validation: ensure we have valid coordinates before adding order
            # This check ensures lat and lng are valid floats
            if not coordinates_valid or lat is None or lng is None:
                # Skip orders without valid coordinates
                debug_stats['no_coordinates'] += 1
                continue
            
            debug_stats['passed_all_filters'] += 1
            
            # Ensure lat and lng are floats (safety check)
            try:
                lat = float(lat)
                lng = float(lng)
            except (ValueError, TypeError):
                continue
            
            # Fulfillment location is already determined from province mapping above
            # fulfillment_location_name is already set from province mapping
            
            # Tags are already extracted above for LOCAL tag check
            
            # Extract shipping method and charge for display purposes
            shipping_line = order.get('shippingLine', {})
            shipping_title = shipping_line.get('title', '') if shipping_line else ''
            # Extract shipping charge
            shipping_price_set = shipping_line.get('originalPriceSet', {}) if shipping_line else {}
            shipping_money = shipping_price_set.get('shopMoney', {}) if shipping_price_set else {}
            shipping_charge = shipping_money.get('amount', '0') if shipping_money else '0'
            shipping_currency = shipping_money.get('currencyCode', '') if shipping_money else ''
            
            # Extract route tag if exists (supports rota#, rota-, and ld_rota- formats)
            # Priority: ld_rota-XX (saved to Shopify) > rota-XX > rota#XX
            route_tag = ''
            ld_tags_found = []
            for tag in tags:
                if tag.startswith('ld_rota-'):
                    # Extract the route name from ld_rota-XX format (this is the format saved to Shopify)
                    # Convert ld_rota-XX to rota-XX for internal use
                    route_tag = tag.replace('ld_', '')
                    ld_tags_found.append(tag)
                    # Prioritize ld_rota-XX format and break to avoid overwriting
                    break
                elif tag.startswith('rota#') or tag.startswith('rota-'):
                    # Only use this if we haven't found ld_rota-XX yet
                    if not route_tag:
                        route_tag = tag
            
            # If Shopify no longer has the route tag, ensure local history is cleared
            if not route_tag and order.get('id') in tags_history:
                self._remove_from_tags_history([order.get('id')])
            
            # If order has local delivery tags, add to history
            if ld_tags_found:
                self._add_to_tags_history(order.get('id', ''), ld_tags_found)
            
            # Check if order has delivery issues
            has_devolucao = 'ld_devolucao' in tags
            has_reentrega = 'ld_reentrega' in tags
            is_fulfilled = fulfillment_status_upper == "FULFILLED"
            
            # Validate address format
            address1 = shipping_address.get('address1', '')
            address2 = shipping_address.get('address2', '')
            address_validation = self._validate_address_format(address1, address2)
            
            # Check if order is allocated to a different fulfillment location
            # (actual fulfillment location differs from mapped location)
            is_allocated_to_different_location = self._is_order_allocated_to_different_location(
                order, fulfillment_location_name
            )
            
            # Check reentrega cache for orders assigned to routes
            # If order is in cache and not delivered, mark for special formatting
            # If order is in cache and delivered, remove the tag
            order_id = order.get('id', '')
            reentrega_cache = self._load_reentrega_cache()
            is_cached_reentrega = order_id in reentrega_cache
            needs_reentrega_formatting = False
            should_remove_reentrega_tag = False
            
            if is_cached_reentrega:
                cache_entry = reentrega_cache[order_id]
                cached_fulfillment_location = cache_entry.get('fulfillment_location', '')
                
                # Only process if fulfillment location matches (or "All fulfillment locations" is selected)
                if (fulfillment_location_filter == "All fulfillment locations" or 
                    cached_fulfillment_location == fulfillment_location_filter):
                    
                    # Check if order is delivered (FULFILLED status means delivered)
                    if is_fulfilled:
                        # Order is delivered - remove the tag
                        should_remove_reentrega_tag = True
                        # Remove from cache
                        self._remove_from_reentrega_cache([order_id])
                        # Remove ld_reentrega from tags
                        if 'ld_reentrega' in tags:
                            tags = [tag for tag in tags if tag != 'ld_reentrega']
                            has_reentrega = False
                    else:
                        # Order not delivered - mark for special formatting
                        needs_reentrega_formatting = True
            
            # Prepare order data
            order_data = {
                'order_id': order_id,
                'order_name': order.get('name', ''),
                'fulfillment_status': fulfillment_status,
                'shipping_method': shipping_title or 'Local Delivery',
                'fulfillment_location': fulfillment_location_name,
                'tags': tags,  # Store tags for pre-sale filtering
                'address': address1,
                'address2': address2,
                'city': shipping_address.get('city', ''),
                'province': shipping_address.get('province', ''),
                'country': shipping_address.get('country', ''),
                'zip': shipping_address.get('zip', ''),
                'latitude': lat,
                'longitude': lng,
                'customer_id': order.get('customer', {}).get('id', '') if order.get('customer') else '',
                'customer_email': order.get('customer', {}).get('email', '') if order.get('customer') else '',
                'customer_name': self._format_customer_name(shipping_address.get('name', '')),
                'phone': shipping_address.get('phone', ''),
                'total_price': order.get('totalPriceSet', {}).get('shopMoney', {}).get('amount', '0'),
                'currency': order.get('totalPriceSet', {}).get('shopMoney', {}).get('currencyCode', ''),
                'shipping_charge': shipping_charge,
                'shipping_currency': shipping_currency,
                'created_at': order.get('createdAt', ''),
                'tags': tags,
                'route_tag': route_tag,
                'has_devolucao': has_devolucao,
                'has_reentrega': has_reentrega,
                'is_fulfilled': is_fulfilled,
                'has_return': has_devolucao,  # Keep for backward compatibility
                'address_validation': address_validation,
                'is_allocated_to_different_location': is_allocated_to_different_location,
                'needs_reentrega_formatting': needs_reentrega_formatting,
                'should_remove_reentrega_tag': should_remove_reentrega_tag
            }
            
            processed.append(order_data)
        
        # Log debug statistics if no orders were processed
        if len(processed) == 0 and progress_callback:
            progress_callback(
                f"Debug: Total={debug_stats['total']}, "
                f"No shipping address={debug_stats['no_shipping_address']}, "
                f"LOCAL tag filtered={debug_stats['shipping_method_filtered']}, "
                f"Date tag filtered={debug_stats['date_tag_filtered']}, "
                f"Cancelled filtered={debug_stats['cancelled_filtered']}, "
                f"Pre-sale filtered={debug_stats['presale_filtered']}, "
                f"Status filtered={debug_stats['fulfillment_status_filtered']}, "
                f"Province/Location filtered={debug_stats['location_filtered']}, "
                f"No coordinates={debug_stats['no_coordinates']}, "
                f"Passed all={debug_stats['passed_all_filters']}"
            )
        
        return processed, future_dated_orders
    
    def _display_orders_map(self, orders_data: List[Dict], fulfillment_location_filter: str = "All fulfillment locations", orders_col=None, map_col=None):
        """Display orders on an interactive map with selection support"""
        if not orders_data:
            st.warning("No orders with valid coordinates to display.")
            return
        
        # Pre-sale tag filtering is handled only in the Orders list, not on the map
        
        # Check if this rerun was caused by checkbox change (don't refresh map) or explicit refresh request
        last_action = st.session_state.get('last_action', 'initial_load')
        map_refresh_needed = st.session_state.get('map_refresh_needed', False)
        
        # Track if we should skip map recreation (when checkbox changed but map refresh not requested)
        # Note: We still need to render the selection panel, so we can't return early entirely
        skip_map_recreation = (last_action == "checkbox_change" and not map_refresh_needed and 'map_container_created' in st.session_state)
        
        # Check if map refresh was requested
        if map_refresh_needed:
            st.session_state.map_refresh_needed = False  # Reset flag
            st.session_state.last_action = "refresh_map"
            skip_map_recreation = False  # Force map recreation on refresh request
        
        # Selection info
        if st.session_state.selected_orders:
            st.info(f"📌 {len(st.session_state.selected_orders)} order(s) selected. Select a route to assign them.")
        
        # Fetch and geocode fulfillment locations (only the selected one)
        fulfillment_locations_data = []
        if self.config:
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    async def fetch_locations():
                        async with ShopifyGraphQLClient() as client:
                            _, locations = await self._fetch_all_locations(client)
                            return locations
                    
                    locations = loop.run_until_complete(fetch_locations())
                    
                    # Filter fulfillment locations based on selection
                    # If "All fulfillment locations" is selected, show all locations
                    # Otherwise, show only the selected location
                    if fulfillment_location_filter == "All fulfillment locations":
                        filtered_locations = locations
                    else:
                        filtered_locations = [
                            loc for loc in locations 
                            if loc.get('name', '') == fulfillment_location_filter
                        ]
                    
                    # Geocode locations that don't have coordinates
                    for location in filtered_locations:
                        address = location.get('address', {})
                        lat = address.get('latitude')
                        lng = address.get('longitude')
                        
                        # If no coordinates, geocode the address
                        if not lat or not lng:
                            address_parts = {
                                'address1': address.get('address1', ''),
                                'address2': address.get('address2', ''),
                                'city': address.get('city', ''),
                                'province': address.get('province', ''),
                                'country': address.get('country', ''),
                                'zip': address.get('zip', '')
                            }
                            
                            try:
                                geocoded_lat, geocoded_lng = self.geocoding_service.geocode_address(address_parts)
                                if geocoded_lat and geocoded_lng:
                                    lat = float(geocoded_lat)
                                    lng = float(geocoded_lng)
                            except:
                                continue
                        
                        # Validate coordinates
                        try:
                            lat_float = float(lat) if lat else None
                            lng_float = float(lng) if lng else None
                            
                            if lat_float and lng_float and -90 <= lat_float <= 90 and -180 <= lng_float <= 180:
                                fulfillment_locations_data.append({
                                    'name': location.get('name', ''),
                                    'latitude': lat_float,
                                    'longitude': lng_float,
                                    'address': address
                                })
                        except:
                            continue
                finally:
                    loop.close()
            except Exception as e:
                st.warning(f"Could not fetch fulfillment locations: {str(e)}")
        
        # Calculate center of map (average of all coordinates including fulfillment locations)
        # This maintains the initial zoom to available orders regions behavior
        all_lats = [order['latitude'] for order in orders_data]
        all_lngs = [order['longitude'] for order in orders_data]
        
        # Add fulfillment location coordinates
        for loc in fulfillment_locations_data:
            all_lats.append(loc['latitude'])
            all_lngs.append(loc['longitude'])
        
        calculated_center_lat = sum(all_lats) / len(all_lats) if all_lats else 0
        calculated_center_lng = sum(all_lngs) / len(all_lngs) if all_lngs else 0
        
        # Check if user has manually adjusted map position (stored in session state)
        # If user has panned/zoomed, restore their position; otherwise use calculated center
        if 'map_center' in st.session_state and 'map_zoom' in st.session_state:
            # User has panned/zoomed - restore their position
            map_center = st.session_state.map_center
            map_zoom = st.session_state.map_zoom
        else:
            # Initial load - use calculated center (MAINTAINS INITIAL ZOOM BEHAVIOR)
            map_center = [calculated_center_lat, calculated_center_lng]
            map_zoom = 10  # Initial zoom level
        
        # Create map
        m = folium.Map(
            location=map_center,
            zoom_start=map_zoom,
            tiles='CartoDB positron'
        )
        
        # Add fullscreen button
        plugins.Fullscreen(
            position='topright',
            title='Expand me',
            title_cancel='Exit me',
            force_separate_button=True
        ).add_to(m)
        
        # Add fulfillment location markers first (so they appear below order markers)
        for location in fulfillment_locations_data:
            location_name = location.get('name', 'Unknown')
            # Use CPG Labs pattern toggled button color scheme for fulfillment locations
            color = '#253858'  # Dark blue used for toggled buttons in CPG Labs UI
            
            # Create custom HTML icon with astronaut emoji and location name (same layout as customer orders)
            icon_html = f"""
            <div style="
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                font-family: Arial, sans-serif;
                text-align: center;
            ">
                <div style="
                    color: {color};
                    font-size: 30px;
                    line-height: 1;
                    margin-bottom: 2px;
                ">👨‍🚀</div>
                <span style="
                    background-color: #F4F5F7;
                    color: {color};
                    font-size: 14px;
                    font-weight: bold;
                    padding: 2px 4px;
                    border-radius: 3px;
                    border: 1.5px solid {color};
                    display: inline-block;
                    margin-top: -3px;
                    white-space: nowrap;
                ">{location_name}</span>
            </div>
            """
            
            address = location.get('address', {})
            address_parts = []
            if address.get('address1'):
                address_parts.append(address['address1'])
            if address.get('address2'):
                address_parts.append(address['address2'])
            city_province = []
            if address.get('city'):
                city_province.append(address['city'])
            if address.get('province'):
                city_province.append(address['province'])
            if city_province:
                address_parts.append(', '.join(city_province))
            if address.get('zip'):
                address_parts.append(address['zip'])
            if address.get('country'):
                address_parts.append(address['country'])
            
            formatted_address = '<br>'.join(address_parts) if address_parts else 'Address not available'
            
            location_popup_html = f"""
            <div style="font-family: Arial; min-width: 200px;">
                <h4 style="margin: 0 0 10px 0; color: #9B59B6;">👨‍🚀 {location_name}</h4>
                <p style="margin: 5px 0;"><strong>Type:</strong> Fulfillment Location</p>
                <p style="margin: 5px 0;"><strong>Address:</strong><br>{formatted_address}</p>
            </div>
            """
            
            folium.Marker(
                location=[location['latitude'], location['longitude']],
                popup=folium.Popup(location_popup_html, max_width=300),
                tooltip=f"👨‍🚀 {location_name} (Fulfillment Location)",
                icon=folium.DivIcon(
                    html=icon_html,
                    icon_size=(100, 50),
                    icon_anchor=(50, 50)
                )
            ).add_to(m)
        
        # Create order_id to index mapping for selection
        order_id_to_idx = {order['order_id']: idx for idx, order in enumerate(orders_data)}
        
        # Assign colors to orders (avoiding conflicts for nearby orders)
        color_palette = self._get_color_palette()
        used_colors = {}  # Track assigned colors by order_id
        
        # Sort orders by density (orders with more neighbors first) for better color distribution
        orders_with_neighbors = []
        for order in orders_data:
            nearby = self._get_nearby_orders(order, orders_data, threshold=500.0)
            orders_with_neighbors.append((len(nearby), order))
        orders_with_neighbors.sort(key=lambda x: x[0], reverse=True)
        
        # Assign colors
        for _, order in orders_with_neighbors:
            order_id = order.get('order_id', '')
            nearby = self._get_nearby_orders(order, orders_data, threshold=500.0)
            assigned_color = self._assign_order_color(order, nearby, color_palette, used_colors)
            used_colors[order_id] = assigned_color
            order['assigned_color'] = assigned_color
        
        # Add markers for each order
        for idx, order in enumerate(orders_data, 1):
            order_id = order.get('order_id', '')
            is_selected = order_id in st.session_state.selected_orders
            route_tag = order.get('route_tag', '')
            tags = order.get('tags', [])
            # Normalize tags to list if needed
            if isinstance(tags, str):
                tags = [tag.strip() for tag in tags.split(',') if tag.strip()]
            elif not isinstance(tags, list):
                tags = []
            is_fulfilled = order.get('is_fulfilled', False)
            
            # Get the correct emoji for this order
            # Assigned route formatting overrides due-tomorrow (clock) formatting
            delivery_promise = st.session_state.get('delivery_promise', "Next day")
            promise_days_map = {
                "Next day": 1,
                "Day +2": 2,
                "Day +3": 3
            }
            promise_days = promise_days_map.get(delivery_promise, 1)
            order_age_days = self._get_order_age_days(order)
            is_due_tomorrow = (
                order_age_days is not None and order_age_days == max(promise_days - 1, 0)
            )
            is_due_later = (
                order_age_days is not None and order_age_days < max(promise_days - 1, 0)
            )
            if route_tag:
                order_emoji = self._get_order_emoji(tags, is_fulfilled)
            elif is_due_tomorrow:
                order_emoji = "⏰"  # Alarm clock emoji for tomorrow
            elif is_due_later:
                order_emoji = "🕐"  # Clock emoji for later
            else:
                order_emoji = self._get_order_emoji(tags, is_fulfilled)
            
            # If order is assigned to a route, replace parcel emoji (📦) with route color circle
            if route_tag and order_emoji == "📦":
                route_color = self._get_route_color(route_tag)
                if route_color:
                    color_circle = self._get_route_color_circle_emoji(route_color)
                    if color_circle:
                        order_emoji = color_circle
            
            # Add 🎯 before emoji if order is allocated to a different fulfillment location
            is_allocated_to_different_location = order.get('is_allocated_to_different_location', False)
            if is_allocated_to_different_location and order_emoji:
                order_emoji = f"🎯{order_emoji}"
            
            # Add ⚠️ before emoji if order needs reentrega formatting (non-delivered cached reentrega)
            needs_reentrega_formatting = order.get('needs_reentrega_formatting', False)
            if needs_reentrega_formatting and order_emoji:
                order_emoji = f"⚠️{order_emoji}"
            
            # Create popup content
            fulfillment_location = order.get('fulfillment_location', 'Unknown')
            route_info = f"<p style='margin: 5px 0;'><strong>Route:</strong> {route_tag}</p>" if route_tag else ""
            
            # Add tag info to popup
            tag_info = ""
            if 'ld_devolucao' in tags:
                tag_info += f"<p style='margin: 5px 0; color: #FF6B35;'><strong>↩️ Return Order:</strong> Item will be returned to fulfillment location</p>"
            if 'ld_reentrega' in tags:
                tag_info += f"<p style='margin: 5px 0; color: #4CAF50;'><strong>📦🔄 Re-delivery Order:</strong> Order needs to be re-delivered</p>"
            
            selection_status = "✅ SELECTED" if is_selected else "⬜ Not selected"
            selection_color = "#4CAF50" if is_selected else "#999999"
            popup_html = f"""
            <div style="font-family: Arial; min-width: 200px;">
                <h4 style="margin: 0 0 10px 0; color: #1E90FF;">{order['order_name']}</h4>
                <p style="margin: 5px 0; color: {selection_color}; font-weight: bold;">{selection_status}</p>
                <p style="margin: 5px 0;"><strong>Status:</strong> {order['fulfillment_status']}</p>
                <p style="margin: 5px 0;"><strong>Shipping:</strong> {order['shipping_method']}</p>
                {route_info}
                {tag_info}
                <p style="margin: 5px 0;"><strong>Fulfillment Location:</strong> {fulfillment_location}</p>
                <p style="margin: 5px 0;"><strong>Address:</strong><br>
                {order['address']}<br>
                {order.get('address2', '')}<br>
                {order['city']}, {order['province']}<br>
                {order['zip']}, {order['country']}</p>
                {f"<p style='margin: 5px 0;'><strong>Customer:</strong> {order['customer_name']}</p>" if order['customer_name'] else ""}
                {f"<p style='margin: 5px 0;'><strong>Phone:</strong> {order['phone']}</p>" if order['phone'] else ""}
                <p style="margin: 5px 0;"><strong>Total:</strong> {order['currency']} {order['total_price']}</p>
            </div>
            """
            
            # Choose marker color based on route assignment, selection status, and assigned color
            # Priority: route color > due tomorrow (grey) > selected (red) > assigned color > unselected (gray)
            assigned_color = order.get('assigned_color', '#808080')
            # is_due_tomorrow already determined above for emoji selection
            
            if route_tag:
                # Order assigned to route - use route color
                route_color = self._get_route_color(route_tag)
                if route_color:
                    color = route_color
                else:
                    color = assigned_color
            elif is_due_tomorrow:
                # Orders due tomorrow always use grey
                color = '#808080'
            elif is_selected:
                color = 'red'  # Selected delivery addresses (not yet assigned)
            else:
                color = assigned_color  # Use assigned color for unselected orders
            
            # Create custom HTML icon with emoji and order number
            order_number = order['order_name']  # e.g., "#1001" or "1001"
            # Extract just the number part if order_name includes "#"
            order_num = order_number.replace('#', '') if '#' in order_number else order_number
            
            # Create emoji HTML - handle multi-character emojis
            # Check if emoji contains multiple emoji characters (like 🔄↩️)
            # Regular single emojis: 📦, 🔄, ↩️
            # Multi-emoji combinations: 🔄↩️
            single_emojis = ["📦", "🔄", "↩️"]
            is_multi_emoji = order_emoji not in single_emojis
            
            if is_multi_emoji:
                # Multi-character emoji - render each character separately
                emoji_parts = []
                # Split emoji string into individual characters for proper rendering
                for char in order_emoji:
                    emoji_parts.append(f'<span style="color: {color}; font-size: 30px; line-height: 1;">{char}</span>')
                emoji_html = f"""
                <div style="
                    display: flex;
                    flex-direction: row;
                    align-items: center;
                    justify-content: center;
                    gap: 2px;
                ">
                    {''.join(emoji_parts)}
                </div>
                """
            else:
                # Single emoji
                emoji_html = f"""
                <div style="
                    color: {color};
                    font-size: 30px;
                    line-height: 1;
                    margin-bottom: 2px;
                ">{order_emoji}</div>
                """
            
            # Apply special formatting for reentrega orders (non-delivered cached)
            if needs_reentrega_formatting:
                order_num_style = f"""
                    background-color: #FFD700;
                    color: #000000;
                    font-size: 18px;
                    font-weight: bold;
                    padding: 2px 4px;
                    border-radius: 3px;
                    border: 1.5px solid #000000;
                    display: inline-block;
                    margin-top: -3px;
                    white-space: nowrap;
                """
            else:
                order_num_style = f"""
                    background-color: white;
                    color: {color};
                    font-size: 18px;
                    font-weight: bold;
                    padding: 2px 4px;
                    border-radius: 3px;
                    border: 1.5px solid {color};
                    display: inline-block;
                    margin-top: -3px;
                    white-space: nowrap;
                """
            
            icon_html = f"""
            <div style="
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                font-family: Arial, sans-serif;
                text-align: center;
            ">
                {emoji_html}
                <span style="{order_num_style}">{order_num}</span>
            </div>
            """
            
            # Create enhanced tooltip with selection status and hover info
            tooltip_parts = [f"{idx}. {order['order_name']}"]
            tooltip_parts.append(f"Status: {order['fulfillment_status']}")
            tooltip_parts.append(f"City: {order['city']}")
            if is_selected:
                tooltip_parts.append("✅ SELECTED - Click to deselect")
            else:
                tooltip_parts.append("⬜ Click to select")
            if route_tag:
                tooltip_parts.append(f"Route: {route_tag}")
            if 'ld_devolucao' in tags:
                tooltip_parts.append("↩️ Return order")
            if 'ld_reentrega' in tags:
                tooltip_parts.append("📦🔄 Re-delivery order")
            if order.get('customer_name'):
                tooltip_parts.append(f"Customer: {order['customer_name']}")
            
            tooltip_text = "<br>".join(tooltip_parts)
            
            # Add marker with custom icon (home + order number)
            marker = folium.Marker(
                location=[order['latitude'], order['longitude']],
                popup=folium.Popup(popup_html, max_width=300),
                tooltip=folium.Tooltip(tooltip_text, sticky=True),
                icon=folium.DivIcon(
                    html=icon_html,
                    icon_size=(40, 40),
                    icon_anchor=(20, 40)
                )
            )
            # Store order_id as a custom attribute for click detection
            marker._order_id = order_id
            marker.add_to(m)
        
        # Render all assigned routes on the map
        assigned_routes_map: Dict[str, List[Dict[str, Any]]] = {}
        for order in orders_data:
            route_tag = order.get('route_tag', '')
            if not route_tag:
                continue
            if route_tag not in assigned_routes_map:
                assigned_routes_map[route_tag] = []
            assigned_routes_map[route_tag].append(order)
        
        if assigned_routes_map and fulfillment_locations_data:
            fulfillment_location = fulfillment_locations_data[0]
            fulfillment_coords = (fulfillment_location['latitude'], fulfillment_location['longitude'])
            
            def _extract_route_number(route_name: str) -> int:
                try:
                    if route_name.startswith('rota-'):
                        return int(route_name.replace('rota-', '').strip())
                    return 999
                except (ValueError, AttributeError):
                    return 999
            
            sorted_assigned_routes = sorted(assigned_routes_map.items(), key=lambda x: _extract_route_number(x[0]))
            
            for route_tag, route_orders in sorted_assigned_routes:
                route_color = self._get_route_color(route_tag) or '#1E90FF'
                
                optimized_sequence = self._optimize_route_sequence(
                    route_orders,
                    start_coords=fulfillment_coords
                )
                
                route_points = [fulfillment_coords]
                for order in optimized_sequence:
                    route_points.append((order['latitude'], order['longitude']))
                
                for i in range(len(route_points) - 1):
                    origin = route_points[i]
                    destination = route_points[i + 1]
                    
                    route_coordinates = self._get_driving_route(origin, destination)
                    folium.PolyLine(
                        route_coordinates,
                        weight=3,
                        color=route_color,
                        opacity=0.6
                    ).add_to(m)
        
        # Automatic route rendering when orders are selected and route is chosen
        selected_orders_ids = st.session_state.get('selected_orders', set())
        selected_route_name = st.session_state.get('selected_route_for_rendering')
        
        if selected_orders_ids and selected_route_name and fulfillment_locations_data:
            # Get selected orders from all orders data
            selected_orders = [
                order for order in orders_data 
                if order.get('order_id', '') in selected_orders_ids
            ]
            
            if len(selected_orders) > 0:
                # Get fulfillment location
                fulfillment_location = fulfillment_locations_data[0]
                fulfillment_coords = (fulfillment_location['latitude'], fulfillment_location['longitude'])
                
                # Get route color
                route_color = self._get_route_color(selected_route_name)
                if not route_color:
                    route_color = '#1E90FF'  # Default blue
                
                # Create optimized route through all selected orders
                # Start from fulfillment location, visit all selected orders in optimized sequence
                optimized_sequence = self._optimize_route_sequence(
                    selected_orders,
                    start_coords=fulfillment_coords
                )
                
                # Build route: fulfillment -> order1 -> order2 -> ... -> orderN
                route_points = [fulfillment_coords]
                for order in optimized_sequence:
                    route_points.append((order['latitude'], order['longitude']))
                
                # Draw route segments with actual driving routes
                for i in range(len(route_points) - 1):
                    origin = route_points[i]
                    destination = route_points[i + 1]
                    
                    # Draw shortest route for this segment
                    route_coordinates = self._get_driving_route(origin, destination)
                    folium.PolyLine(
                        route_coordinates,
                        color=route_color,
                        weight=4,
                        opacity=0.8
                    ).add_to(m)
        
        # Display map only (Orders section is rendered separately in col1)
        # Use passed column or create new one if not provided
        if map_col is None:
            map_col = st.container()
        
        with map_col:
            # Display map and handle interactions
            # Always render the map - Streamlit widgets rerender on rerun, but using stored position/zoom
            # and a stable key helps maintain state. The map will restore to last position when possible.
            try:
                from streamlit_folium import st_folium
                # Map marker click selection removed - users select orders via checkboxes in side panel only
                # This completely disassociates order selection from map interactions
                # Return bounds to capture user's pan/zoom position
                # Use a stable key so Streamlit can maintain widget state across reruns
                # Note: Map will be recreated on rerun, but position/zoom will be restored from session_state
                map_data = st_folium(m, width=None, height=1000, key="delivery_map", returned_objects=["bounds"])
                # Mark that map container has been created
                st.session_state.map_container_created = True
                
                # Store map position if user has panned/zoomed
                # Always try to capture bounds to maintain position
                if map_data:
                    bounds = map_data.get('bounds')
                    if bounds and isinstance(bounds, dict) and 'north' in bounds and 'south' in bounds and 'east' in bounds and 'west' in bounds:
                        # Calculate center from bounds
                        center_lat = (bounds['north'] + bounds['south']) / 2
                        center_lng = (bounds['east'] + bounds['west']) / 2
                        # Store center
                        st.session_state.map_center = [center_lat, center_lng]
                        # Estimate zoom from bounds (approximate)
                        # Calculate zoom based on bounds span
                        lat_span = bounds['north'] - bounds['south']
                        # Approximate zoom level (this is a rough estimate)
                        if lat_span > 0:
                            # Rough zoom estimation based on latitude span
                            if lat_span > 50:
                                estimated_zoom = 4
                            elif lat_span > 20:
                                estimated_zoom = 5
                            elif lat_span > 10:
                                estimated_zoom = 6
                            elif lat_span > 5:
                                estimated_zoom = 7
                            elif lat_span > 2:
                                estimated_zoom = 8
                            elif lat_span > 1:
                                estimated_zoom = 9
                            elif lat_span > 0.5:
                                estimated_zoom = 10
                            elif lat_span > 0.2:
                                estimated_zoom = 11
                            elif lat_span > 0.1:
                                estimated_zoom = 12
                            else:
                                estimated_zoom = 13
                            st.session_state.map_zoom = estimated_zoom
                        else:
                            # Fallback to stored zoom or default
                            if 'map_zoom' not in st.session_state:
                                st.session_state.map_zoom = 10
            except ImportError:
                st.error("streamlit-folium is required for map display. Please install it: pip install streamlit-folium")
                st.info("Map would be displayed here with all delivery addresses plotted.")
    
    def _display_orders_selection(self, orders_data: List[Dict]):
        """Display orders selection interface with checkboxes and route assignment"""
        # Selection interface (works for both map clicks and manual selection)
        # Check for shipment requests and display warning/button if needed
        fulfillment_location_filter = st.session_state.get('fulfillment_location_filter', 'All fulfillment locations')
        shipment_requests_count = self._count_shipment_requests(orders_data, fulfillment_location_filter)
        
        if shipment_requests_count > 0:
            # Display warning message
            st.warning("⚠️ There are shipment requests to process")
            
            # Display red button to manage shipment requests
            if st.button("Manage shipment requests", type="primary", use_container_width=True, key="manage_shipment_requests_button"):
                # Toggle shipment requests section visibility
                # Initialize to True on first click, then toggle
                if 'shipment_requests_section_visible' not in st.session_state:
                    st.session_state.shipment_requests_section_visible = True
                else:
                    st.session_state.shipment_requests_section_visible = not st.session_state.shipment_requests_section_visible
                st.rerun()
        
        # Include all orders in display (both assigned and unassigned)
        # Route-assigned orders will be shown in "Orders due today" section
        
        # Sort orders by order number (higher to lower - descending)
        def extract_order_number(order_name: str) -> int:
            """Extract numeric order number from order name (e.g., '58219' or '#58219')"""
            try:
                # Remove '#' if present and extract number
                order_num_str = order_name.replace('#', '').strip()
                return int(order_num_str)
            except (ValueError, AttributeError):
                return 0
        
        orders_data_sorted = sorted(orders_data, key=lambda x: extract_order_number(x.get('order_name', '0')), reverse=True)
        display_orders = orders_data_sorted
        
        # Separate orders into "Orders due today", "Orders due tomorrow", and "Orders due later"
        # Route-assigned orders always go to "Orders due today" (regardless of creation date)
        # Unassigned orders are separated by delivery promise
        orders_due_today = []
        orders_due_tomorrow = []
        orders_due_later = []
        
        delivery_promise = st.session_state.get('delivery_promise', "Next day")
        promise_days_map = {
            "Next day": 1,
            "Day +2": 2,
            "Day +3": 3
        }
        promise_days = promise_days_map.get(delivery_promise, 1)
        
        for order in display_orders:
            route_tag = order.get('route_tag', '')
            order_age_days = self._get_order_age_days(order)
            
            if route_tag:
                # Orders assigned to routes always go to "Orders due today"
                orders_due_today.append(order)
            elif order_age_days is not None:
                if order_age_days >= promise_days:
                    # Orders outside the promise window go to "Orders due today"
                    orders_due_today.append(order)
                elif order_age_days == max(promise_days - 1, 0):
                    # Orders one day before due date go to "Orders due tomorrow"
                    orders_due_tomorrow.append(order)
                else:
                    # Orders still farther from due date go to "Orders due later"
                    orders_due_later.append(order)
            else:
                # Fallback to "Orders due today" when order age is unknown
                orders_due_today.append(order)

        # Debug instrumentation state (no PII)
        checkboxes_rendered = {"value": False, "rendered_count": 0}
        # region agent log
        with open(r"c:\Users\Lucas Guimarães\Desktop\cpg-labs\.streamlit\.cursor\debug.log", "a", encoding="utf-8") as f:
            f.write(json.dumps({
                "sessionId": "debug-session",
                "runId": "pre-fix",
                "hypothesisId": "H1",
                "location": "_local_delivery.py:_display_orders_selection:entry",
                "message": "orders_selection_entry",
                "data": {
                    "orders_due_today": len(orders_due_today),
                    "orders_due_tomorrow": len(orders_due_tomorrow),
                    "orders_due_later": len(orders_due_later),
                    "selected_orders_count": len(st.session_state.get("selected_orders", set())),
                    "last_action": st.session_state.get("last_action")
                },
                "timestamp": int(datetime.now().timestamp() * 1000)
            }) + "\n")
        # endregion
        # region agent log
        with open(r"c:\Users\Lucas Guimarães\Desktop\cpg-labs\.streamlit\.cursor\debug.log", "a", encoding="utf-8") as f:
            f.write(json.dumps({
                "sessionId": "debug-session",
                "runId": "pre-fix",
                "hypothesisId": "H2",
                "location": "_local_delivery.py:_display_orders_selection:bulk_action:entry",
                "message": "bulk_action_state",
                "data": {
                    "bulk_select_action": st.session_state.get("bulk_select_action"),
                    "selected_orders_count": len(st.session_state.get("selected_orders", set()))
                },
                "timestamp": int(datetime.now().timestamp() * 1000)
            }) + "\n")
        # endregion

        # Apply any pending bulk selection action before rendering checkboxes
        bulk_action = st.session_state.get("bulk_select_action")
        if bulk_action in ("select_all", "deselect_all"):
            # region agent log
            with open(r"c:\Users\Lucas Guimarães\Desktop\cpg-labs\.streamlit\.cursor\debug.log", "a", encoding="utf-8") as f:
                f.write(json.dumps({
                    "sessionId": "debug-session",
                    "runId": "pre-fix",
                    "hypothesisId": "H2",
                    "location": "_local_delivery.py:_display_orders_selection:bulk_action:before",
                    "message": "bulk_action_apply",
                    "data": {
                        "action": bulk_action,
                        "orders_due_today": len(orders_due_today),
                        "selected_orders_count": len(st.session_state.get("selected_orders", set()))
                    },
                    "timestamp": int(datetime.now().timestamp() * 1000)
                }) + "\n")
            # endregion
            if bulk_action == "select_all":
                for order in orders_due_today:
                    order_id = order.get('order_id', '')
                    if order_id:
                        st.session_state.selected_orders.add(order_id)
                        st.session_state[f"select_{order_id}"] = True
            else:
                for order in orders_due_today:
                    order_id = order.get('order_id', '')
                    if order_id in st.session_state.selected_orders:
                        st.session_state.selected_orders.remove(order_id)
                    if order_id:
                        st.session_state[f"select_{order_id}"] = False
            st.session_state.bulk_select_action = None
            # region agent log
            with open(r"c:\Users\Lucas Guimarães\Desktop\cpg-labs\.streamlit\.cursor\debug.log", "a", encoding="utf-8") as f:
                f.write(json.dumps({
                    "sessionId": "debug-session",
                    "runId": "pre-fix",
                    "hypothesisId": "H2",
                    "location": "_local_delivery.py:_display_orders_selection:bulk_action:after",
                    "message": "bulk_action_applied",
                    "data": {
                        "selected_orders_count": len(st.session_state.get("selected_orders", set()))
                    },
                    "timestamp": int(datetime.now().timestamp() * 1000)
                }) + "\n")
            # endregion
        
        # Helper function to display a single order
        def _render_order_checkbox(order: Dict[str, Any]) -> None:
            """Render a single order checkbox with proper formatting."""
            order_id = order.get('order_id', '')
            order_name = order.get('order_name', 'Unknown')
            customer_name = order.get('customer_name', '')
            is_selected = order_id in st.session_state.selected_orders
            route_tag = order.get('route_tag', '')
            tags = order.get('tags', [])
            
            # Normalize tags to list if needed
            if isinstance(tags, str):
                tags = [tag.strip() for tag in tags.split(',') if tag.strip()]
            elif not isinstance(tags, list):
                tags = []
            
            is_fulfilled = order.get('is_fulfilled', False)
            
            # Get the correct emoji for this order
            order_emoji = self._get_order_emoji(tags, is_fulfilled)
            
            route_display = f" [{route_tag}]" if route_tag else ""
            # Only show emoji in list if it's not the regular delivery emoji (📦)
            # Regular orders (📦) should not show emoji in the list
            emoji_display = f" {order_emoji}" if order_emoji and order_emoji != "📦" else ""
            
            # Add customer name if available, preceded by " | "
            # Add 🎯 after customer name if order is allocated to a different fulfillment location
            is_allocated_to_different_location = order.get('is_allocated_to_different_location', False)
            allocation_indicator = " 🎯" if is_allocated_to_different_location else ""
            customer_display = f" | {customer_name}{allocation_indicator}" if customer_name else ""
            
            # Check address validation status for red dot indicator
            address_validation = order.get('address_validation', {})
            is_address_valid = address_validation.get('is_valid', True)
            address_warning = "🔴 " if not is_address_valid else ""
            
            # Add ⚠️ before order name if order needs reentrega formatting (non-delivered cached reentrega)
            needs_reentrega_formatting = order.get('needs_reentrega_formatting', False)
            reentrega_warning = "⚠️ " if needs_reentrega_formatting else ""
            
            # Format order name: bold by default, remove bold if already assigned to a route
            if route_tag:
                # Order already assigned - no bold
                checkbox_label_text = f"{address_warning}{reentrega_warning}{order_name}{customer_display}{emoji_display}{route_display}"
            else:
                # Order not assigned - make order number bold
                checkbox_label_text = f"{address_warning}{reentrega_warning}**{order_name}**{customer_display}{emoji_display}{route_display}"
            
            # Checkbox tracks its own state but doesn't update selected_orders immediately
            # selected_orders is only updated when "Select All", "Deselect All", or a route is selected
            checkbox_key = f"select_{order_id}"
            
            # Initialize checkbox state if not exists (use current selection state)
            if checkbox_key not in st.session_state:
                st.session_state[checkbox_key] = is_selected
            
            # Get current checkbox state (this is the local state, not synced to selected_orders yet)
            current_state = st.session_state[checkbox_key]
            
            # Render checkbox
            st.checkbox(
                checkbox_label_text,
                value=current_state,
                key=checkbox_key
            )
            checkboxes_rendered["value"] = True
            checkboxes_rendered["rendered_count"] += 1
            if checkboxes_rendered["rendered_count"] == 1:
                # region agent log
                with open(r"c:\Users\Lucas Guimarães\Desktop\cpg-labs\.streamlit\.cursor\debug.log", "a", encoding="utf-8") as f:
                    f.write(json.dumps({
                        "sessionId": "debug-session",
                        "runId": "pre-fix",
                        "hypothesisId": "H3",
                        "location": "_local_delivery.py:_display_orders_selection:first_checkbox",
                        "message": "first_checkbox_rendered",
                        "data": {
                            "checkbox_key_exists": checkbox_key in st.session_state,
                            "current_state": current_state,
                            "bulk_select_action": st.session_state.get("bulk_select_action")
                        },
                        "timestamp": int(datetime.now().timestamp() * 1000)
                    }) + "\n")
                # endregion
        
        # Orders (due today)
        st.markdown("#### Orders due today")
        
        # Action buttons below Orders header - only affect orders due today
        btn_col1, btn_col2 = st.columns(2)
        with btn_col1:
            if st.button("❌ Deselect All", use_container_width=True, key="deselect_all_selection"):
                existing_state_count = sum(
                    1 for order in orders_due_today
                    if f"select_{order.get('order_id', '')}" in st.session_state
                )
                # region agent log
                with open(r"c:\Users\Lucas Guimarães\Desktop\cpg-labs\.streamlit\.cursor\debug.log", "a", encoding="utf-8") as f:
                    f.write(json.dumps({
                        "sessionId": "debug-session",
                        "runId": "pre-fix",
                        "hypothesisId": "H1",
                        "location": "_local_delivery.py:_display_orders_selection:deselect_all:before",
                        "message": "deselect_all_clicked",
                        "data": {
                            "checkboxes_rendered": checkboxes_rendered["value"],
                            "rendered_count": checkboxes_rendered["rendered_count"],
                            "orders_due_today": len(orders_due_today),
                            "existing_state_keys": existing_state_count,
                            "selected_orders_count": len(st.session_state.get("selected_orders", set()))
                        },
                        "timestamp": int(datetime.now().timestamp() * 1000)
                    }) + "\n")
                # endregion
                st.session_state.bulk_select_action = "deselect_all"
                # Mark that this was a button click, not a map refresh request
                st.session_state.last_action = "checkbox_change"
                st.rerun()
                # Don't call st.rerun() - map will update when route is selected
        
        with btn_col2:
            if st.button("✅ Select All", use_container_width=True, key="select_all_orders"):
                existing_state_count = sum(
                    1 for order in orders_due_today
                    if f"select_{order.get('order_id', '')}" in st.session_state
                )
                # region agent log
                with open(r"c:\Users\Lucas Guimarães\Desktop\cpg-labs\.streamlit\.cursor\debug.log", "a", encoding="utf-8") as f:
                    f.write(json.dumps({
                        "sessionId": "debug-session",
                        "runId": "pre-fix",
                        "hypothesisId": "H1",
                        "location": "_local_delivery.py:_display_orders_selection:select_all:before",
                        "message": "select_all_clicked",
                        "data": {
                            "checkboxes_rendered": checkboxes_rendered["value"],
                            "rendered_count": checkboxes_rendered["rendered_count"],
                            "orders_due_today": len(orders_due_today),
                            "existing_state_keys": existing_state_count,
                            "selected_orders_count": len(st.session_state.get("selected_orders", set()))
                        },
                        "timestamp": int(datetime.now().timestamp() * 1000)
                    }) + "\n")
                # endregion
                st.session_state.bulk_select_action = "select_all"
                # Mark that this was a button click, not a map refresh request
                st.session_state.last_action = "checkbox_change"
                st.rerun()
        
        # Status bar below Orders header (orders due today only)
        total_due_today = len(orders_due_today)
        assigned_due_today = sum(1 for order in orders_due_today if order.get('route_tag', ''))
        progress_due_today = assigned_due_today / total_due_today if total_due_today > 0 else 0.0
        st.progress(progress_due_today, text=f"{assigned_due_today} / {total_due_today} orders")
        if orders_due_today:
            # Always divide orders into two equal columns
            col_left, col_right = st.columns(2)
            
            # Calculate split: left gets ceil(n/2), right gets floor(n/2)
            total_orders = len(orders_due_today)
            left_count = math.ceil(total_orders / 2)
            right_count = total_orders - left_count
            
            # Display orders in left column (first ceil(n/2) orders)
            with col_left:
                for order_idx in range(left_count):
                    if order_idx < len(orders_due_today):
                        order = orders_due_today[order_idx]
                        _render_order_checkbox(order)
            
            # Display orders in right column (remaining floor(n/2) orders)
            with col_right:
                for order_idx in range(left_count, total_orders):
                    if order_idx < len(orders_due_today):
                        order = orders_due_today[order_idx]
                        _render_order_checkbox(order)
            
        else:
            st.caption("No orders due today.")
        
        # Orders due tomorrow
        st.markdown("#### Orders due tomorrow")
        total_due_tomorrow = len(orders_due_tomorrow)
        assigned_due_tomorrow = sum(1 for order in orders_due_tomorrow if order.get('route_tag', ''))
        progress_due_tomorrow = assigned_due_tomorrow / total_due_tomorrow if total_due_tomorrow > 0 else 0.0
        st.progress(progress_due_tomorrow, text=f"{assigned_due_tomorrow} / {total_due_tomorrow} orders")
        
        if orders_due_tomorrow:
            col_left, col_right = st.columns(2)
            
            total_orders = len(orders_due_tomorrow)
            left_count = math.ceil(total_orders / 2)
            right_count = total_orders - left_count
            
            with col_left:
                for order_idx in range(left_count):
                    if order_idx < len(orders_due_tomorrow):
                        order = orders_due_tomorrow[order_idx]
                        _render_order_checkbox(order)
            
            with col_right:
                for order_idx in range(left_count, total_orders):
                    if order_idx < len(orders_due_tomorrow):
                        order = orders_due_tomorrow[order_idx]
                        _render_order_checkbox(order)
        else:
            st.caption("No orders due tomorrow.")
        
        # Orders due later (only when promise is later than next day)
        if promise_days > 1:
            st.markdown("#### Orders due later")
            total_due_later = len(orders_due_later)
            assigned_due_later = sum(1 for order in orders_due_later if order.get('route_tag', ''))
            progress_due_later = assigned_due_later / total_due_later if total_due_later > 0 else 0.0
            st.progress(progress_due_later, text=f"{assigned_due_later} / {total_due_later} orders")
            
            if orders_due_later:
                col_left, col_right = st.columns(2)
                
                total_orders = len(orders_due_later)
                left_count = math.ceil(total_orders / 2)
                right_count = total_orders - left_count
                
                with col_left:
                    for order_idx in range(left_count):
                        if order_idx < len(orders_due_later):
                            order = orders_due_later[order_idx]
                            _render_order_checkbox(order)
                
                with col_right:
                    for order_idx in range(left_count, total_orders):
                        if order_idx < len(orders_due_later):
                            order = orders_due_later[order_idx]
                            _render_order_checkbox(order)
            else:
                st.caption("No orders due later.")
        
        # Route selection - single select
        # Get all available routes and format them for display
        route_options = ["Select a route"]
        route_display_to_internal = {}  # Map display format to internal format
        route_entries: List[Tuple[str, str, bool]] = []  # (display_name, route_name, has_orders_in_location)
        orders_data = st.session_state.get('delivery_orders_data', [])
        routes_with_orders_in_location: Dict[str, bool] = {}
        if orders_data:
            for order in orders_data:
                route_tag = order.get('route_tag', '')
                if not route_tag:
                    continue
                if fulfillment_location_filter != "All fulfillment locations":
                    if order.get('fulfillment_location') != fulfillment_location_filter:
                        continue
                routes_with_orders_in_location[route_tag] = True
        
        if 'delivery_routes' in st.session_state:
            for route_id, route_data in st.session_state.delivery_routes.items():
                route_name = route_data.get('name', '')
                has_orders = routes_with_orders_in_location.get(route_name, False)
                # Convert "rota-01" to "Rota #01" for display
                if route_name.startswith('rota-'):
                    try:
                        route_num = route_name.replace('rota-', '')
                        display_name = f"Rota #{route_num}"
                        route_entries.append((display_name, route_name, has_orders))
                    except:
                        pass
        
        # Sort routes: unassigned first, then alphabetical by display name
        route_entries_sorted = sorted(route_entries, key=lambda x: (x[2], x[0].lower()))
        unassigned_routes = [(d, r, h) for d, r, h in route_entries_sorted if not h]
        assigned_routes = [(d, r, h) for d, r, h in route_entries_sorted if h]
        
        for display_name, route_name, _ in unassigned_routes:
            route_options.append(display_name)
            route_display_to_internal[display_name] = route_name
        
        if assigned_routes:
            route_options.append("---Already assigned routes---")
        
        for display_name, route_name, _ in assigned_routes:
            route_options.append(display_name)
            route_display_to_internal[display_name] = route_name
        
        # Route selection and assign button stacked vertically
        # NOTE: Given that the selectbox has a caption element, the button and selectbox do not align
        # perfectly on the UI when placed side-by-side in columns. Therefore, it is better to keep
        # them stacked vertically.
        
        # Route selection - single selectbox
        # Keep a stable key so the selection persists after assignment
        selectbox_key = "route_selection_selectbox"
        selected_route_display = st.selectbox(
            "Assign orders to:",
            options=route_options,
            key=selectbox_key
        )
        
        # Sync checkbox states to selected_orders set when route is selected
        # This updates the map to show selected orders in red (selectbox change triggers rerun automatically)
        if selected_route_display and selected_route_display not in ["Select a route", "---Already assigned routes---"]:
            # Sync checkbox states to selected_orders set
            st.session_state.selected_orders = set()
            for order in display_orders:
                order_id = order.get('order_id', '')
                checkbox_key = f"select_{order_id}"
                if st.session_state.get(checkbox_key, False):
                    st.session_state.selected_orders.add(order_id)
            
            # Store selected route for map rendering
            route_name = route_display_to_internal.get(selected_route_display)
            if route_name:
                st.session_state.selected_route_for_rendering = route_name
            else:
                st.session_state.selected_route_for_rendering = None
            
            # Trigger map refresh to show selected orders and routes
            st.session_state.map_refresh_needed = True
            st.session_state.last_action = "refresh_map"
        else:
            # Clear route rendering if no route selected
            st.session_state.selected_route_for_rendering = None
        
        # Assign orders button - enabled only when orders are selected and route is chosen
        if st.session_state.selected_orders and selected_route_display and selected_route_display not in ["Select a route", "---Already assigned routes---"]:
            if st.button("✅ Assign Orders", use_container_width=True, type="primary", key="assign_orders_from_selection"):
                    selected_ids = list(st.session_state.selected_orders)
                    
                    # Get the selected route
                    route_name = route_display_to_internal.get(selected_route_display)
                    if route_name:
                        # Find route_id from route_name
                        route_id = None
                        for rid, rdata in st.session_state.delivery_routes.items():
                            if rdata.get('name') == route_name:
                                route_id = rid
                                break
                        
                        if route_id and route_id in st.session_state.delivery_routes:
                            # Add selected orders to route
                            existing_ids = set(st.session_state.delivery_routes[route_id]['order_ids'])
                            new_ids = [oid for oid in selected_ids if oid not in existing_ids]
                            st.session_state.delivery_routes[route_id]['order_ids'].extend(new_ids)
                            
                            # Update order data with route tag
                            for order in st.session_state.delivery_orders_data:
                                if order['order_id'] in new_ids:
                                    # Remove any existing route tags first
                                    tags = order.get('tags', [])
                                    # Remove any existing ld_rota-XX or rota-XX tags
                                    tags = [tag for tag in tags if not (tag.startswith('ld_rota-') or tag.startswith('rota-') or tag.startswith('rota#'))]
                                    # Add new route tag in format ld_rota-XX
                                    shopify_tag = f"ld_{route_name}"
                                    tags.append(shopify_tag)
                                    order['tags'] = tags
                                    order['route_tag'] = route_name
                            
                            # Update Shopify tags with ld_rota-XX format
                            shopify_tag = f"ld_{route_name}"
                            self._update_order_tags_batch(new_ids, shopify_tag)
                            
                            # Add orders to tags history (with the newly added tag)
                            # Also cache reentrega orders for delivery status tracking
                            fulfillment_location_filter = st.session_state.get('fulfillment_location_filter', 'All fulfillment locations')
                            for order in st.session_state.delivery_orders_data:
                                if order['order_id'] in new_ids:
                                    order_tags = order.get('tags', [])
                                    # Ensure the new tag is included
                                    if shopify_tag not in order_tags:
                                        order_tags = order_tags + [shopify_tag]
                                    self._add_to_tags_history(order['order_id'], order_tags)
                                    
                                    # If order has ld_reentrega tag, add to reentrega cache
                                    if 'ld_reentrega' in order_tags:
                                        order_fulfillment_location = order.get('fulfillment_location', fulfillment_location_filter)
                                        self._add_to_reentrega_cache(
                                            order['order_id'],
                                            order_fulfillment_location,
                                            route_name
                                        )
                            
                            # Persist committed routes summary for this location
                            self._update_committed_routes_cache(
                                fulfillment_location_filter,
                                st.session_state.delivery_orders_data
                            )
                            
                            # Show confirmation info below the button
                            st.info(f"✅ **{len(new_ids)} orders assigned to {selected_route_display}**")
                            
                            st.session_state.selected_orders = set()
                            st.rerun()
        
        # Display future-dated orders below Assign orders (simple list, no checkboxes)
        future_dated_orders = st.session_state.get('future_dated_orders', [])
        if future_dated_orders:
            if fulfillment_location_filter != "All fulfillment locations":
                future_dated_orders = [
                    order for order in future_dated_orders
                    if order.get('fulfillment_location') == fulfillment_location_filter
                ]
            if future_dated_orders:
                st.markdown("#### Orders scheduled for future dates")
                
                # Sort by future date (earliest first)
                future_dated_orders_sorted = sorted(future_dated_orders, key=lambda x: x.get('future_date', date.max))
                
                # Display as simple list (no checkboxes, no toggle)
                for order in future_dated_orders_sorted:
                    order_name = order.get('order_name', 'Unknown')
                    customer_name = order.get('customer_name', '')
                    future_date = order.get('future_date')
                    
                    # Format date for display
                    if future_date:
                        date_str = future_date.strftime('%d/%m/%Y')
                    else:
                        date_str = 'N/A'
                    
                    # Display as simple text (not selectable)
                    customer_display = f" | {customer_name}" if customer_name else ""
                    st.text(f"{order_name}{customer_display} (Due: {date_str})")
        
        # Display committed routes section below Assign Orders button
        self._display_committed_routes()
    
    def _should_show_main_ui(self) -> bool:
        """Determine if main UI (controls, map) should be displayed
        
        Returns:
            True if main UI should be shown, False otherwise
        """
        # If shipment requests section is visible, don't show main UI
        if st.session_state.get('shipment_requests_section_visible', False):
            return False
        
        # If shipment requests were just processed successfully, show main UI
        if st.session_state.get('shipment_requests_processed_successfully', False):
            # Clear the flag after using it
            st.session_state.shipment_requests_processed_successfully = False
            return True
        
        # Check if there are shipment requests
        if not self.config:
            return True  # No config, show main UI
        
        # Check if shipment requests exist (quick check without full fetch)
        # If we've already checked and stored the count, use it
        if 'shipment_requests_count' in st.session_state:
            count = st.session_state.get('shipment_requests_count', 0)
            # If there are shipment requests but section is not visible, show main UI
            # (user clicked Skip or processed successfully)
            return count == 0 or not st.session_state.get('shipment_requests_section_visible', False)
        
        # Default: show main UI
        return True
    
    async def _fetch_shipment_requests_orders(self, client: ShopifyGraphQLClient) -> List[Dict]:
        """Fetch shipment requests orders using pre-filtered query
        
        Filters:
        - Tag: LOCAL
        - Not fulfilled (fulfillment_status:unfulfilled)
        - Assigned to CD Cajamar or CD Extrema (filtered in post-processing)
        
        Args:
            client: ShopifyGraphQLClient instance
            
        Returns:
            List of order dictionaries matching shipment request criteria
        """
        # Build query filters - pre-filter at Shopify level
        query_filters = [
            "tag:LOCAL",
            "fulfillment_status:unfulfilled"
        ]
        query_string = " AND ".join(query_filters)
        
        all_orders = []
        cursor = None
        page_size = 50
        
        while True:
            variables = {
                "first": page_size,
                "after": cursor,
                "query": query_string
            }
            
            result = await client.execute_query(SHIPMENT_REQUESTS_QUERY, variables)
            
            orders_data = result.get('data', {}).get('orders', {})
            edges = orders_data.get('edges', [])
            
            if not edges:
                break
            
            orders_batch = [edge['node'] for edge in edges]
            all_orders.extend(orders_batch)
            
            page_info = orders_data.get('pageInfo', {})
            if not page_info.get('hasNextPage', False):
                break
            
            cursor = page_info.get('endCursor')
        
        # Post-process: Filter by fulfillment location (CD Cajamar or CD Extrema)
        # Check fulfillments to see if order is assigned to these locations
        target_locations = ["CD Cajamar", "CD Extrema"]
        filtered_orders = []
        
        for order in all_orders:
            # Check if order is fulfilled from CD Cajamar or CD Extrema
            fulfillments = order.get('fulfillments', [])
            is_from_target_location = False
            
            for fulfillment in fulfillments:
                location = fulfillment.get('location', {})
                location_name = location.get('name', '')
                if location_name in target_locations:
                    is_from_target_location = True
                    break
            
            # Only include orders from target locations
            if is_from_target_location:
                filtered_orders.append(order)
        
        return filtered_orders
    
    def _display_shipment_requests_section_at_top(self):
        """Display shipment requests section at the top of the UI (after description, before controls)"""
        # Check if section should be visible
        if not st.session_state.get('shipment_requests_section_visible', False):
            # Show warning and button if there are shipment requests
            if not self.config:
                return
            
            # Fetch shipment requests count asynchronously
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                
                async def check_shipment_requests():
                    async with ShopifyGraphQLClient() as client:
                        orders = await self._fetch_shipment_requests_orders(client)
                        return len(orders)
                
                shipment_requests_count = loop.run_until_complete(check_shipment_requests())
                loop.close()
                
                # Store count in session state for _should_show_main_ui
                st.session_state.shipment_requests_count = shipment_requests_count
                
                if shipment_requests_count > 0:
                    st.warning("⚠️ There are shipment requests to process")
                    
                    if st.button("Manage shipment requests", type="primary", use_container_width=True, key="manage_shipment_requests_button_top"):
                        # Toggle shipment requests section visibility
                        if 'shipment_requests_section_visible' not in st.session_state:
                            st.session_state.shipment_requests_section_visible = True
                        else:
                            st.session_state.shipment_requests_section_visible = not st.session_state.shipment_requests_section_visible
                        st.rerun()
                else:
                    # No shipment requests, clear the count
                    st.session_state.shipment_requests_count = 0
            except Exception as e:
                # Silently fail - don't block UI if there's an error
                pass
            return
        
        # Display full shipment requests section
        render_subsection_header("Shipment Requests")
        
        # Display persistent error messages if any
        if 'shipment_requests_errors' in st.session_state and st.session_state.shipment_requests_errors:
            st.divider()
            render_subsection_header("Errors")
            failed_results = st.session_state.shipment_requests_errors
            st.error(f"❌ {len(failed_results)} shipment request(s) failed:")
            for result in failed_results:
                st.write(f"- **{result['order_name']}**: {result.get('error', 'Unknown error')}")
            
            # Add button to clear errors
            if st.button("Clear Errors", key="clear_shipment_errors", use_container_width=True):
                del st.session_state.shipment_requests_errors
                # Clear selected orders and reload
                if 'selected_shipment_request_orders' in st.session_state:
                    st.session_state.selected_shipment_request_orders = set()
                # Force reload by clearing cached orders
                if 'shipment_requests_orders' in st.session_state:
                    del st.session_state.shipment_requests_orders
                st.rerun()
            
            st.divider()
        
        if not self.config:
            st.error("Shopify configuration not found. Please configure your Shopify credentials.")
            return
        
        # Fetch shipment requests orders using pre-filtered query
        with st.spinner("Loading shipment requests..."):
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                
                async def fetch_orders():
                    async with ShopifyGraphQLClient() as client:
                        return await self._fetch_shipment_requests_orders(client)
                
                raw_orders = loop.run_until_complete(fetch_orders())
                loop.close()
                
                if not raw_orders:
                    st.info("No shipment requests found.")
                    return
                
                # Process orders to match expected format
                eligible_orders = []
                for order in raw_orders:
                    # Extract order data
                    order_id = order.get('id', '')
                    order_name = order.get('name', 'Unknown')
                    
                    # Get customer name
                    customer = order.get('customer', {})
                    customer_name = ''
                    if customer:
                        first_name = customer.get('firstName', '')
                        last_name = customer.get('lastName', '')
                        if first_name or last_name:
                            customer_name = f"{first_name} {last_name}".strip()
                    
                    # Get province to determine target location
                    shipping_address = order.get('shippingAddress', {})
                    province = shipping_address.get('province', '')
                    
                    # Determine target fulfillment location based on province
                    target_location = None
                    if province:
                        target_location = self.PROVINCE_TO_LOCATION_MAP.get(province)
                    
                    if not target_location:
                        continue
                    
                    # Build order dict in expected format
                    eligible_orders.append({
                        'order_id': order_id,
                        'order_name': order_name,
                        'customer_name': customer_name,
                        'fulfillment_location': target_location,
                        'province': province
                    })
                
                if not eligible_orders:
                    st.info("No shipment requests found.")
                    return
                
                # Store in session state for processing
                st.session_state.shipment_requests_orders = eligible_orders
                
                # Display eligible orders count
                st.info(f"{len(eligible_orders)} shipment request(s) to process.")
                
                # Initialize selected shipment request orders in session state
                if 'selected_shipment_request_orders' not in st.session_state:
                    st.session_state.selected_shipment_request_orders = set()
                
                # Display orders with checkboxes
                selected_order_ids = st.session_state.selected_shipment_request_orders
                
                for order in eligible_orders:
                    order_id = order.get('order_id', '')
                    order_name = order.get('order_name', 'Unknown')
                    customer_name = order.get('customer_name', '')
                    mapped_location = order.get('fulfillment_location', '')
                    
                    checkbox_key = f"shipment_request_select_{order_id}"
                    is_selected = order_id in selected_order_ids
                    
                    label = f"**{order_name}**"
                    if customer_name:
                        label += f" | {customer_name}"
                    label += f" ({mapped_location})"
                    
                    if st.checkbox(label, value=is_selected, key=checkbox_key):
                        selected_order_ids.add(order_id)
                    else:
                        selected_order_ids.discard(order_id)
                
                st.session_state.selected_shipment_request_orders = selected_order_ids
                
                # Cancel button - always visible at the same level as the list
                if st.button("Cancel", use_container_width=True, key="shipment_request_cancel_top"):
                    st.session_state.selected_shipment_request_orders = set()
                    st.session_state.shipment_requests_section_visible = False
                    # Clear the count to allow main UI to show
                    if 'shipment_requests_count' in st.session_state:
                        st.session_state.shipment_requests_count = 0
                    st.rerun()
                
                # Action buttons - only show Process button when orders are selected
                if selected_order_ids:
                    selected_orders_list = [o for o in eligible_orders if o.get('order_id') in selected_order_ids]
                    
                    # Process button - only shown when orders are selected
                    if st.button("Process request(s)", type="primary", use_container_width=True, key="shipment_request_confirm_top"):
                        # Determine fulfillment location from first order (they should all have same target)
                        fulfillment_location = eligible_orders[0].get('fulfillment_location', 'All fulfillment locations') if eligible_orders else 'All fulfillment locations'
                        # Process shipment requests
                        self._process_shipment_requests(selected_orders_list, fulfillment_location)
                
            except Exception as e:
                st.error(f"Error loading shipment requests: {str(e)}")
    
    def _display_shipment_requests_section(self):
        """Display shipment requests section for managing orders (legacy - kept for compatibility)"""
        # This method is kept for backward compatibility but redirects to the top section
        self._display_shipment_requests_section_at_top()
    
    def _process_shipment_requests(self, orders: List[Dict], fulfillment_location: str):
        """Process shipment requests for selected orders
        
        Args:
            orders: List of order dictionaries for shipment requests
            fulfillment_location: Target fulfillment location
        """
        if not self.config:
            st.error("Shopify configuration not found. Please configure your Shopify credentials.")
            return
        
        # Initialize processor
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        try:
            async def process_orders():
                async with ShopifyGraphQLClient() as client:
                    processor = ShipmentRequestProcessor(client)
                    results = []
                    
                    for order in orders:
                        order_id = order.get('order_id', '')
                        order_name = order.get('order_name', 'Unknown')
                        
                        try:
                            # Fetch full order data
                            full_order_data = await processor.fetch_full_order_data(order_id)
                            if not full_order_data:
                                # Provide more detailed error message
                                import logging
                                log = logging.getLogger(__name__)
                                log.warning(f"Could not fetch order data for {order_name} (ID: {order_id})")
                                results.append({
                                    'order_name': order_name,
                                    'success': False,
                                    'error': f'Could not fetch order data (ID: {order_id}). Ensure your Shopify access token has "read_orders" scope. If order is older than 60 days, "read_all_orders" scope is required.'
                                })
                                continue
                            
                            # Extract order data
                            extracted_data = processor.extract_order_data(full_order_data)
                            
                            # Validate eligibility
                            is_eligible, issues = processor.validate_shipment_request_eligibility(extracted_data)
                            if not is_eligible:
                                results.append({
                                    'order_name': order_name,
                                    'success': False,
                                    'error': f"Not eligible: {', '.join(issues)}"
                                })
                                continue
                            
                            # Handle out of stock items
                            extracted_data = processor.handle_out_of_stock_items(extracted_data)
                            
                            # Determine target location
                            target_location = processor.determine_shipment_request_location(
                                order,
                                self.PROVINCE_TO_LOCATION_MAP
                            )
                            
                            if not target_location:
                                results.append({
                                    'order_name': order_name,
                                    'success': False,
                                    'error': 'Could not determine target fulfillment location'
                                })
                                continue
                            
                            # Transform order data
                            transformed_data = processor.transform_order_data(
                                extracted_data,
                                target_location,
                                order_name
                            )
                            
                            # Create shipment request order
                            create_result = await processor.create_shipment_request_order(transformed_data)
                            
                            if create_result.get('success'):
                                new_order_id = create_result.get('order_id')
                                new_order_name = create_result.get('order_name', 'Unknown')
                                
                                # Link orders
                                await processor.link_orders(
                                    order_id,
                                    new_order_id,
                                    order_name,
                                    new_order_name
                                )
                                
                                # Log shipment request
                                processor.log_shipment_request(
                                    order_id,
                                    order_name,
                                    new_order_id,
                                    new_order_name,
                                    target_location,
                                    'success'
                                )
                                
                                results.append({
                                    'order_name': order_name,
                                    'success': True,
                                    'new_order_name': new_order_name
                                })
                            else:
                                error = create_result.get('error', 'Unknown error')
                                processor.log_shipment_request(
                                    order_id,
                                    order_name,
                                    None,
                                    None,
                                    target_location,
                                    'failure',
                                    [error]
                                )
                                results.append({
                                    'order_name': order_name,
                                    'success': False,
                                    'error': error
                                })
                        
                        except Exception as e:
                            import logging
                            log = logging.getLogger(__name__)
                            log.error(f"Error processing shipment request for {order_name}: {e}")
                            results.append({
                                'order_name': order_name,
                                'success': False,
                                'error': str(e)
                            })
                    
                    return results
            
            with st.spinner("Processing shipment requests..."):
                results = loop.run_until_complete(process_orders())
            
            # Display results
            st.divider()
            render_subsection_header("Shipment Request Results")
            
            success_count = sum(1 for r in results if r.get('success'))
            failure_count = len(results) - success_count
            
            if success_count > 0:
                st.success(f"✅ Successfully created {success_count} shipment request(s)")
                for result in results:
                    if result.get('success'):
                        st.write(f"- {result['order_name']} → {result.get('new_order_name', 'Unknown')}")
            
            if failure_count > 0:
                # Store failed results in session state for persistent display
                failed_results = [r for r in results if not r.get('success')]
                st.session_state.shipment_requests_errors = failed_results
                
                st.error(f"❌ Failed to create {failure_count} shipment request(s)")
                for result in failed_results:
                    st.write(f"- {result['order_name']}: {result.get('error', 'Unknown error')}")
            else:
                # Clear errors if all succeeded
                if 'shipment_requests_errors' in st.session_state:
                    del st.session_state.shipment_requests_errors
            
            # Clear selection but keep section visible if there are errors
            st.session_state.selected_shipment_request_orders = set()
            
            # Only hide section if all succeeded, otherwise keep it visible to show persistent errors
            if failure_count == 0:
                # If at least one order was created successfully, show main UI
                if success_count > 0:
                    st.session_state.shipment_requests_processed_successfully = True
                st.session_state.shipment_requests_section_visible = False
                # Reload orders to refresh the display
                st.info("Reloading orders to refresh display...")
                st.rerun()
            else:
                # Keep section visible to show persistent errors
                st.rerun()
        
        finally:
            loop.close()
    
    def _display_committed_routes(self):
        """Display committed routes with order counts and total shipping charges"""
        fulfillment_location_filter = st.session_state.get('fulfillment_location_filter', 'All fulfillment locations')
        route_summary: Dict[str, Dict[str, Any]] = {}
        orders_data = st.session_state.get('delivery_orders_data', [])
        
        if orders_data:
            # Update cache from current data and use it for display
            self._update_committed_routes_cache(
                fulfillment_location_filter,
                orders_data
            )
            route_summary = self._calculate_committed_routes_summary(orders_data)
        else:
            # Fallback to cached summary for this location and day
            route_summary = self._get_committed_routes_summary(fulfillment_location_filter)
        
        # Only display if there are committed routes
        if route_summary:
            render_section_header("Committed routes")
            
            route_orders_map: Dict[str, List[Dict[str, Any]]] = {}
            if orders_data:
                for order in orders_data:
                    route_tag = order.get('route_tag', '')
                    if not route_tag:
                        continue
                    if route_tag not in route_orders_map:
                        route_orders_map[route_tag] = []
                    route_orders_map[route_tag].append(order)
            
            def _format_route_display_name(route_tag: str) -> str:
                """Format route name for display."""
                if route_tag.startswith('rota-'):
                    try:
                        route_num = route_tag.replace('rota-', '')
                        return f"Rota #{route_num}"
                    except Exception:
                        return route_tag
                return route_tag
            
            def _unassign_order_from_route(order_id: str, route_tag: str) -> None:
                """Unassign order from route and update local/Shopify data."""
                if not order_id or not route_tag:
                    return
                
                # Update local order data
                for order in orders_data:
                    if order.get('order_id', '') != order_id:
                        continue
                    tags = order.get('tags', [])
                    if isinstance(tags, str):
                        tags = [tag.strip() for tag in tags.split(',') if tag.strip()]
                    elif not isinstance(tags, list):
                        tags = []
                    
                    # Remove any route tags
                    tags = [tag for tag in tags if not (tag.startswith('ld_rota-') or tag.startswith('rota-') or tag.startswith('rota#'))]
                    order['tags'] = tags
                    order['route_tag'] = ''
                    break
                
                # Update delivery_routes state (remove from route list)
                if 'delivery_routes' in st.session_state:
                    for route_id, route_data in st.session_state.delivery_routes.items():
                        if route_data.get('name') == route_tag:
                            route_data['order_ids'] = [oid for oid in route_data.get('order_ids', []) if oid != order_id]
                            break
                
                # Remove tag from Shopify
                shopify_tag = f"ld_{route_tag}"
                self._remove_order_tags_batch([order_id], [shopify_tag])
                
                # Remove from tags history
                self._remove_from_tags_history([order_id])
                
                # Update committed routes cache
                if orders_data:
                    self._update_committed_routes_cache(fulfillment_location_filter, orders_data)
                
                # Refresh map and UI
                st.session_state.map_refresh_needed = True
                st.session_state.last_action = "refresh_map"
            
            def _unassign_all_orders_from_route(route_tag: str, route_orders: List[Dict[str, Any]]) -> None:
                """Unassign all orders from a route and update local/Shopify data."""
                if not route_tag or not route_orders:
                    return
                
                order_ids = []
                for order in route_orders:
                    order_id = order.get('order_id', '')
                    if order_id:
                        order_ids.append(order_id)
                    
                    tags = order.get('tags', [])
                    if isinstance(tags, str):
                        tags = [tag.strip() for tag in tags.split(',') if tag.strip()]
                    elif not isinstance(tags, list):
                        tags = []
                    
                    # Remove any route tags
                    tags = [tag for tag in tags if not (tag.startswith('ld_rota-') or tag.startswith('rota-') or tag.startswith('rota#'))]
                    order['tags'] = tags
                    order['route_tag'] = ''
                
                # Update delivery_routes state (remove all from route list)
                if 'delivery_routes' in st.session_state:
                    for route_id, route_data in st.session_state.delivery_routes.items():
                        if route_data.get('name') == route_tag:
                            existing_ids = route_data.get('order_ids', [])
                            route_data['order_ids'] = [oid for oid in existing_ids if oid not in order_ids]
                            break
                
                # Remove tag from Shopify for all orders in route
                shopify_tag = f"ld_{route_tag}"
                if order_ids:
                    self._remove_order_tags_batch(order_ids, [shopify_tag])
                    self._remove_from_tags_history(order_ids)
                
                # Update committed routes cache
                if orders_data:
                    self._update_committed_routes_cache(fulfillment_location_filter, orders_data)
                
                # Refresh map and UI
                st.session_state.map_refresh_needed = True
                st.session_state.last_action = "refresh_map"
            
            # Sort routes by route number (rota-01, rota-02, etc.)
            def extract_route_number(route_name: str) -> int:
                """Extract numeric route number from route name (e.g., 'rota-01' -> 1)"""
                try:
                    if route_name.startswith('rota-'):
                        route_num_str = route_name.replace('rota-', '').strip()
                        return int(route_num_str)
                    return 999  # Put non-standard routes at the end
                except (ValueError, AttributeError):
                    return 999
            
            sorted_routes = sorted(route_summary.items(), key=lambda x: extract_route_number(x[0]))
            
            # Display each route with order count and orders inside expander
            for route_tag, route_data in sorted_routes:
                # Get route color for border
                route_color = self._get_route_color(route_tag)
                count = route_data.get('order_count', 0)
                
                # Convert "rota-01" to "Rota #01" for display
                display_name = _format_route_display_name(route_tag)
                
                # Format shipping charge total
                shipping_total = route_data.get('shipping_total', 0.0)
                currency = route_data.get('currency', 'BRL')
                
                # Format currency (BRL -> R$, others use currency code)
                if currency.upper() == 'BRL':
                    currency_symbol = 'R$'
                else:
                    currency_symbol = currency
                
                # Format amount with 2 decimal places and Brazilian number format (comma for decimal, dot for thousands)
                try:
                    # Format with 2 decimal places
                    formatted_amount = f"{shipping_total:.2f}"
                    # Replace decimal point with comma (Brazilian format)
                    formatted_amount = formatted_amount.replace('.', ',')
                    shipping_display = f"{currency_symbol}{formatted_amount}"
                except:
                    shipping_display = f"{currency_symbol}{shipping_total:.2f}"
                
                # Build display text with order count and shipping charges
                display_text = f"{display_name} ({count} orders; {shipping_display})"
                route_emoji = self._get_route_color_circle_emoji(route_color) if route_color else None
                expander_label = f"{route_emoji} {display_text}" if route_emoji else display_text
                
                with st.expander(expander_label):
                    route_orders = route_orders_map.get(route_tag, [])
                    if not route_orders:
                        st.caption("No orders loaded for this route in the current session.")
                        continue
                    
                    confirm_all_key = f"confirm_unassign_all_{route_tag}"
                    if st.session_state.get(confirm_all_key, False):
                        st.warning("Confirm unassign all orders from this route?")
                        cancel_clicked, confirm_clicked = render_dual_buttons(
                            "Cancel",
                            "Confirm unassign all",
                            secondary_key=f"cancel_unassign_all_{route_tag}",
                            primary_key=f"confirm_unassign_all_{route_tag}"
                        )
                        if cancel_clicked:
                            st.session_state[confirm_all_key] = False
                            st.rerun()
                        if confirm_clicked:
                            _unassign_all_orders_from_route(route_tag, route_orders)
                            st.session_state[confirm_all_key] = False
                            st.rerun()
                    else:
                        if render_primary_button("Unassign all", key=f"unassign_all_{route_tag}"):
                            st.session_state[confirm_all_key] = True
                            st.rerun()
                    
                    for idx, order in enumerate(route_orders):
                        order_id = order.get('order_id', '')
                        order_key_suffix = order_id or f"{route_tag}_{idx}"
                        order_name = order.get('order_name', 'Unknown')
                        customer_name = order.get('customer_name', '')
                        customer_display = f" | {customer_name}" if customer_name else ""
                        order_label = f"{order_name}{customer_display}"
                        
                        info_col, action_col = st.columns([3, 1])
                        with info_col:
                            st.write(order_label)
                        
                        with action_col:
                            confirm_key = f"confirm_unassign_{order_key_suffix}"
                            if st.session_state.get(confirm_key, False):
                                st.warning("Confirm unassign?")
                                cancel_clicked, confirm_clicked = render_dual_buttons(
                                    "Cancel",
                                    "Confirm unassign",
                                    secondary_key=f"cancel_unassign_{order_key_suffix}",
                                    primary_key=f"confirm_unassign_{order_key_suffix}"
                                )
                                if cancel_clicked:
                                    st.session_state[confirm_key] = False
                                    st.rerun()
                                if confirm_clicked:
                                    _unassign_order_from_route(order_id, route_tag)
                                    st.session_state[confirm_key] = False
                                    st.rerun()
                            else:
                                if st.button("Unassign", key=f"unassign_{order_key_suffix}", use_container_width=True):
                                    st.session_state[confirm_key] = True
                                    st.rerun()
    
    def _display_orders_table(self, orders_data: List[Dict], orders_col=None):
        """Display orders in a table format"""
        render_subsection_header("📋 Orders List")
        
        # Prepare data for display with formatted columns
        display_data = []
        for order in orders_data:
            # Format date
            created_at = order.get('created_at', '')
            if created_at:
                try:
                    # Parse ISO format date
                    dt = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                    formatted_date = dt.strftime('%Y-%m-%d %H:%M')
                except:
                    formatted_date = created_at
            else:
                formatted_date = 'N/A'
            
            # Format shipping address
            address_parts = []
            if order.get('address'):
                address_parts.append(order['address'])
            if order.get('address2'):
                address_parts.append(order['address2'])
            
            city_province = []
            if order.get('city'):
                city_province.append(order['city'])
            if order.get('province'):
                city_province.append(order['province'])
            
            if city_province:
                address_parts.append(', '.join(city_province))
            
            zip_country = []
            if order.get('zip'):
                zip_country.append(order['zip'])
            if order.get('country'):
                zip_country.append(order['country'])
            
            if zip_country:
                address_parts.append(' '.join(zip_country))
            
            formatted_address = '<br>'.join(address_parts) if address_parts else 'N/A'
            
            display_data.append({
                'Order Number': order.get('order_name', 'N/A'),
                'Date': formatted_date,
                'Customer': order.get('customer_name', 'N/A'),
                'Shipping Address': formatted_address,
                'order_id': order.get('order_id', ''),
                'route_tag': order.get('route_tag', '')
            })
        
        # Convert to DataFrame
        df = pd.DataFrame(display_data)
        
        if len(df) > 0:
            # Display table with only the required columns
            display_cols = ['Order Number', 'Date', 'Customer', 'Shipping Address']
            if 'route_tag' in df.columns:
                display_cols.append('Route')
                df['Route'] = df['route_tag'].fillna('')
            
            # Show selection info
            if st.session_state.selected_orders:
                st.info(f"📌 {len(st.session_state.selected_orders)} order(s) selected. Select a route below to assign them.")
            
            # Display table
            st.dataframe(
                df[display_cols],
                use_container_width=True,
                height=400,
                key="orders_display_table"
            )
            
            # Summary statistics
            col1, col2, col3, col4 = st.columns(4)
            with col1:
                st.metric("Total Orders", len(df))
            with col2:
                # Count unique customers
                unique_customers = df['Customer'].nunique() if 'Customer' in df.columns else 0
                st.metric("Unique Customers", unique_customers)
            with col3:
                # Count orders with routes
                orders_with_routes = len(df[df['route_tag'].notna() & (df['route_tag'] != '')]) if 'route_tag' in df.columns else 0
                st.metric("Orders with Routes", orders_with_routes)
            with col4:
                # Count unassigned orders
                unassigned = len(df[df['route_tag'].isna() | (df['route_tag'] == '')]) if 'route_tag' in df.columns else len(df)
                st.metric("Unassigned Orders", unassigned)
    
    def _update_order_tags_batch(self, order_ids: List[str], route_tag: str):
        """Update tags for multiple orders in batch"""
        if not order_ids or not route_tag:
            st.warning("No orders selected or route tag missing.")
            return
        
        if not self.config:
            st.warning("Shopify configuration not found. Tags will not be updated in Shopify, but route assignment is saved locally.")
            return
        
        if len(order_ids) == 0:
            return
        
        with st.spinner(f"Updating tags for {len(order_ids)} orders in Shopify..."):
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    async def update_tags():
                        async with ShopifyGraphQLClient() as client:
                            success_count = 0
                            error_count = 0
                            error_details = []
                            
                            for idx, order_id in enumerate(order_ids):
                                try:
                                    if not order_id:
                                        error_count += 1
                                        continue
                                    
                                    result = await self._update_order_tags(client, order_id, route_tag)
                                    if result:
                                        success_count += 1
                                    else:
                                        error_count += 1
                                        error_details.append(order_id)
                                    
                                    # Small delay to avoid rate limiting
                                    if idx < len(order_ids) - 1:
                                        await asyncio.sleep(0.1)
                                        
                                except Exception as e:
                                    error_count += 1
                                    error_details.append(f"{order_id}: {str(e)}")
                            
                            return success_count, error_count, error_details
                    
                    success, errors, error_details = loop.run_until_complete(update_tags())
                    
                    # Show results
                    if success > 0:
                        st.success(f"✅ Successfully updated tags for {success} order(s) in Shopify")
                    if errors > 0:
                        st.warning(f"⚠️ Failed to update {errors} order(s). Route assignment saved locally.")
                        if error_details and len(error_details) <= 5:
                            with st.expander("Error Details"):
                                for detail in error_details:
                                    st.text(str(detail))
                    
                    # If all failed, still show that local assignment worked
                    if errors == len(order_ids) and success == 0:
                        st.info("⚠️ Could not update Shopify tags, but route assignment has been saved locally. You can try updating tags again later.")
                    
                except Exception as e:
                    st.error(f"Error in batch tag update: {str(e)}")
                    import traceback
                    with st.expander("Error Details"):
                        st.code(traceback.format_exc())
                finally:
                    loop.close()
            except Exception as e:
                st.error(f"Error setting up tag update: {str(e)}")
                import traceback
                with st.expander("Error Details"):
                    st.code(traceback.format_exc())

    def _remove_order_tags_batch(self, order_ids: List[str], tags_to_remove: List[str]) -> None:
        """Remove specific tags for multiple orders in batch."""
        if not order_ids or not tags_to_remove:
            st.warning("No orders selected or tags missing.")
            return
        
        if not self.config:
            st.warning("Shopify configuration not found. Tags will not be updated in Shopify, but unassignment is saved locally.")
            return
        
        with st.spinner(f"Removing tags for {len(order_ids)} orders in Shopify..."):
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    async def remove_tags():
                        async with ShopifyGraphQLClient() as client:
                            success_count = 0
                            error_count = 0
                            error_details = []
                            
                            for idx, order_id in enumerate(order_ids):
                                try:
                                    if not order_id:
                                        error_count += 1
                                        continue
                                    
                                    result = await self._remove_order_tags(client, order_id, tags_to_remove)
                                    if result:
                                        success_count += 1
                                    else:
                                        error_count += 1
                                        error_details.append(order_id)
                                    
                                    # Small delay to avoid rate limiting
                                    if idx < len(order_ids) - 1:
                                        await asyncio.sleep(0.1)
                                        
                                except Exception as e:
                                    error_count += 1
                                    error_details.append(f"{order_id}: {str(e)}")
                            
                            return success_count, error_count, error_details
                    
                    success, errors, error_details = loop.run_until_complete(remove_tags())
                    
                    if success > 0:
                        st.success(f"✅ Successfully removed tags for {success} order(s) in Shopify")
                    if errors > 0:
                        st.warning(f"⚠️ Failed to remove tags from {errors} order(s). Unassignment saved locally.")
                        if error_details and len(error_details) <= 5:
                            with st.expander("Error Details"):
                                for detail in error_details:
                                    st.text(str(detail))
                    
                    if errors == len(order_ids) and success == 0:
                        st.info("⚠️ Could not update Shopify tags, but unassignment has been saved locally. You can try again later.")
                    
                except Exception as e:
                    st.error(f"Error in batch tag removal: {str(e)}")
                    import traceback
                    with st.expander("Error Details"):
                        st.code(traceback.format_exc())
                finally:
                    loop.close()
            except Exception as e:
                st.error(f"Error setting up tag removal: {str(e)}")
                import traceback
                with st.expander("Error Details"):
                    st.code(traceback.format_exc())
    
    async def _update_order_tags(self, client: ShopifyGraphQLClient, order_id: str, route_tag: str) -> bool:
        """Update a single order's tags using GraphQL mutation"""
        if not order_id or not route_tag:
            return False
        
        mutation = """
        mutation tagsAdd($id: ID!, $tags: [String!]!) {
          tagsAdd(id: $id, tags: $tags) {
            node {
              id
              ... on Order {
                tags
              }
            }
            userErrors {
              field
              message
            }
          }
        }
        """
        
        variables = {
            "id": order_id,
            "tags": [route_tag]
        }
        
        try:
            result = await client.execute_query(mutation, variables)
            
            if not result:
                return False
            
            data = result.get('data', {})
            if not data:
                # Check for errors in result
                errors = result.get('errors', [])
                if errors:
                    error_messages = [err.get('message', 'Unknown error') for err in errors]
                    st.warning(f"GraphQL error updating tags for order {order_id}: {', '.join(error_messages)}")
                return False
            
            tags_add = data.get('tagsAdd', {})
            if not tags_add:
                return False
            
            user_errors = tags_add.get('userErrors', [])
            
            if user_errors:
                error_messages = [err.get('message', 'Unknown error') for err in user_errors]
                st.warning(f"Error adding tag to order {order_id}: {', '.join(error_messages)}")
                return False
            
            return True
        except KeyError as e:
            st.warning(f"KeyError updating tags for order {order_id}: {str(e)}")
            return False
        except Exception as e:
            st.warning(f"Exception updating tags for order {order_id}: {str(e)}")
            import traceback
            st.warning(f"Traceback: {traceback.format_exc()}")
            return False


def handle_local_delivery_flow():
    """Main handler for Local Delivery function"""
    # Check which view to show (default to main)
    view = st.session_state.get('local_delivery_view', 'main')
    
    # Route to appropriate subsystem
    try:
        if view == 'fulfillment_optimizer':
            from .fulfillment_optimizer import handle_fulfillment_optimizer_view
            handle_fulfillment_optimizer_view()
            return
        elif view == 'special_tags':
            # Existing delivery issues view
            # Get context info
            context_info = st.session_state.get('context_info', LOCAL_DELIVERY_CONTEXT)
            
            # Initialize mapper
            mapper = DeliveryAddressMapper()
            
            # Render the delivery mapping interface
            mapper.render_delivery_map()
            return
        else:
            # Default main view
            # Get context info
            context_info = st.session_state.get('context_info', LOCAL_DELIVERY_CONTEXT)
            
            # Initialize mapper
            mapper = DeliveryAddressMapper()
            
            # Render the delivery mapping interface
            mapper.render_delivery_map()
            return
    except ImportError as e:
        st.error(f"Subsystem view '{view}' is not yet implemented: {e}")
        # Fallback to main view
        try:
            mapper = DeliveryAddressMapper()
            mapper.render_delivery_map()
        except:
            st.error("Unable to load main view. Please check the installation.")
    except Exception as e:
        st.error(f"Error rendering {view} view: {e}")
        with st.expander("Error Details"):
            st.exception(e)
        # Fallback to main view
        try:
            mapper = DeliveryAddressMapper()
            mapper.render_delivery_map()
        except:
            st.error("Unable to load main view. Please check the installation.")
