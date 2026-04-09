"""
UI Components for Fulfillment Location Optimizer

Provides Streamlit UI components for region selection and results display.

This module implements the user interface for the Fulfillment Location Optimizer feature,
including:
- Data loading controls (period, geographic filters)
- Region selection (bounding box or polygon)
- Order volume visualization
- Top 3 location display with maps
- Location comparison tables
- Detailed metrics display

Usage:
    The UI is integrated into the Local Delivery system as a sub-function.
    Users can access it via the "Fulfillment Optimizer" sub-function in the sidebar.

Components:
    - render_fulfillment_optimizer_view(): Main view entry point
    - render_data_loading_controls(): Data loading controls (period, geographic filters)
    - render_region_selection_ui(): Region selection interface
    - render_results_display(): Results visualization
    - render_top_locations_map(): Map with top 3 locations
    - render_location_comparison(): Comparison table
    - render_location_details(): Detailed metrics

Author: CPG Labs Local Delivery Team
Date: 2024-12-19
"""

import streamlit as st
import pandas as pd
import folium
from folium import plugins
from typing import Dict, List, Tuple, Optional
import json
import math
from datetime import datetime, timedelta

from .fulfillment_optimizer import (
    FulfillmentLocationOptimizer,
    RegionBoundaries,
    OrderVolumeResult,
    haversine_distance
)
from functions.geocommerce.coordinate_storage import CoordinateStorage
from functions.geocommerce.shared_controls import render_data_loading_controls
from functions.geocommerce.config.config import ShopifyConfig
from functions.geocommerce.shared import get_config
from functions.shared.ui_helpers import render_section_header, render_subsection_header, render_form_label
from functions.shared.button_styles import apply_primary_button_styles


def center_radius_to_bbox(center_lat: float, center_lng: float, radius_km: float) -> Dict[str, float]:
    """
    Convert center point + radius to bounding box.
    
    Args:
        center_lat: Center latitude
        center_lng: Center longitude
        radius_km: Radius in kilometers
        
    Returns:
        Dictionary with min_lat, max_lat, min_lng, max_lng
    """
    # Earth radius in km
    R = 6371.0
    
    # Convert radius to degrees (approximate)
    # At equator: 1 degree latitude ≈ 111 km
    # Longitude varies by latitude: 1 degree ≈ 111 km * cos(latitude)
    lat_degrees = radius_km / 111.0
    lng_degrees = radius_km / (111.0 * math.cos(math.radians(center_lat)))
    
    # Calculate bounding box
    min_lat = center_lat - lat_degrees
    max_lat = center_lat + lat_degrees
    min_lng = center_lng - lng_degrees
    max_lng = center_lng + lng_degrees
    
    # Clamp to valid ranges
    min_lat = max(-90.0, min_lat)
    max_lat = min(90.0, max_lat)
    min_lng = max(-180.0, min_lng)
    max_lng = min(180.0, max_lng)
    
    return {
        'min_lat': min_lat,
        'max_lat': max_lat,
        'min_lng': min_lng,
        'max_lng': max_lng
    }


def format_number(value: float) -> str:
    """Format a number with appropriate suffixes (K, M, B)"""
    if pd.isna(value) or value == 0:
        return "0"
    
    if value >= 1_000_000_000:
        return f"{value / 1_000_000_000:.1f}B"
    elif value >= 1_000_000:
        return f"{value / 1_000_000:.1f}M"
    elif value >= 1_000:
        return f"{value / 1_000:.1f}K"
    else:
        return f"{value:,.0f}"


def format_currency(value: float, currency: str = "BRL") -> str:
    """Format a currency value"""
    if pd.isna(value) or value == 0:
        return f"R$ 0,00"
    
    # Format as Brazilian Real by default
    if currency == "BRL":
        return f"R$ {value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    else:
        return f"${value:,.2f}"


def render_fulfillment_optimizer_view():
    """
    Render the main Fulfillment Optimizer view.
    
    This is the main entry point for the fulfillment location optimizer feature.
    Includes data loading controls and region selection/analysis.
    """
    apply_primary_button_styles()
    
    # Render data loading controls first (synced with GeoCommerce session state)
    render_data_loading_controls()
    
    st.markdown("---")
    
    # Check if data is loaded
    # Note: orders_df may be empty when loaded from cache, so we check customers_df instead
    # which is the primary data source for GeoCommerce
    has_data = (
        st.session_state.get('shopify_data_loaded', False) and
        (
            (st.session_state.get('customers_df') is not None and 
             not st.session_state.get('customers_df', pd.DataFrame()).empty) or
            (st.session_state.get('orders_df') is not None and 
             not st.session_state.get('orders_df', pd.DataFrame()).empty)
        )
    )
    
    if not has_data:
        render_section_header("Fulfillment Location Optimizer", "📍")
        st.info("Please load order data first using the 'Load data' in the main tab.")
        return
    
    # Check if we have aggregated coordinate data
    coordinate_storage = CoordinateStorage()
    
    # Apply filters from session state to get filtered aggregates
    filter_params = _collect_filter_parameters()
    aggregates = _get_filtered_aggregates(coordinate_storage, filter_params)
    
    # If aggregates don't exist but we have customer data, create them automatically
    if not aggregates:
        customers_df = st.session_state.get('customers_df')
        if customers_df is not None and not customers_df.empty:
            # Check if customers_df has coordinate data
            if 'latitude' in customers_df.columns and 'longitude' in customers_df.columns:
                with st.spinner("Creating coordinate aggregates from customer data..."):
                    coordinate_storage.aggregate_from_customers_df(customers_df)
                    aggregates = _get_filtered_aggregates(coordinate_storage, filter_params)
        
        # If still no aggregates, show warning
        if not aggregates:
            render_section_header("Fulfillment Location Optimizer", "📍")
            st.warning("No aggregated coordinate data found. Please ensure order data has been loaded and aggregated.")
            return
    
    # Initialize optimizer
    optimizer = st.session_state.get('fulfillment_optimizer')
    if optimizer is None:
        coordinate_storage = CoordinateStorage()
        optimizer = FulfillmentLocationOptimizer(coordinate_storage=coordinate_storage)
        st.session_state.fulfillment_optimizer = optimizer
    
    # Initialize session state for fulfillment optimizer
    if 'fulfillment_region' not in st.session_state:
        st.session_state.fulfillment_region = None
    if 'fulfillment_order_volumes' not in st.session_state:
        st.session_state.fulfillment_order_volumes = None
    if 'fulfillment_top_locations' not in st.session_state:
        st.session_state.fulfillment_top_locations = None
    
    # Render region selection UI (with filtered data)
    render_region_selection_ui(optimizer, aggregates)
    
    # Render results if available
    if st.session_state.fulfillment_top_locations:
        render_results_display(optimizer)


def _collect_filter_parameters() -> Dict:
    """Collect all filter parameters from session state"""
    return {
        'date_filter': st.session_state.get('date_filter', {}),
        'geo_filter': st.session_state.get('geo_filter', {}),
    }


def _get_filtered_aggregates(coordinate_storage: CoordinateStorage, filter_params: Dict) -> List[Dict]:
    """
    Get coordinate aggregates filtered by current session state filters.
    
    Args:
        coordinate_storage: CoordinateStorage instance
        filter_params: Filter parameters from session state
        
    Returns:
        List of filtered aggregate dictionaries
    """
    # Get all aggregates first
    all_aggregates = coordinate_storage.get_coordinate_aggregates()
    
    if not all_aggregates:
        return []
    
    # Apply filters
    filtered = all_aggregates
    
    # Apply geographic filters
    geo_filter = filter_params.get('geo_filter', {})
    if geo_filter:
        provinces = geo_filter.get('provinces', [])
        cities = geo_filter.get('cities', [])
        
        if provinces:
            filtered = [agg for agg in filtered if agg.get('province') in provinces]
        
        if cities:
            filtered = [agg for agg in filtered if agg.get('city') in cities]
    
    # Apply date filters
    date_filter = filter_params.get('date_filter', {})
    if date_filter and date_filter.get('type') != 'all_time':
        # Note: Date filtering on aggregates requires checking first_order_date/last_order_date
        # For now, we'll use all aggregates if date filter is set (can be enhanced later)
        pass
    
    return filtered


def render_region_selection_ui(optimizer: FulfillmentLocationOptimizer, aggregates: List[Dict]):
    """
    Render region selection map with filtered data.
    
    Args:
        optimizer: FulfillmentLocationOptimizer instance
        aggregates: Filtered coordinate aggregates based on current filters
    """
    if not aggregates:
        st.warning("No order data available for the selected filters. Please adjust filters or load data first.")
        return
    
    # Map panel - full width
    # Initialize center point in session state if not exists
    if 'fulfillment_center_lat' not in st.session_state:
        # Default to center of filtered data
        lats = [agg['latitude'] for agg in aggregates]
        lngs = [agg['longitude'] for agg in aggregates]
        st.session_state.fulfillment_center_lat = sum(lats) / len(lats) if lats else -14.235004
        st.session_state.fulfillment_center_lng = sum(lngs) / len(lngs) if lngs else -51.92528
    else:
        # Update center if aggregates changed (recalculate from filtered data)
        lats = [agg['latitude'] for agg in aggregates]
        lngs = [agg['longitude'] for agg in aggregates]
        if lats and lngs:
            new_center_lat = sum(lats) / len(lats)
            new_center_lng = sum(lngs) / len(lngs)
            # Only update if significantly different
            if abs(new_center_lat - st.session_state.fulfillment_center_lat) > 0.1 or \
               abs(new_center_lng - st.session_state.fulfillment_center_lng) > 0.1:
                st.session_state.fulfillment_center_lat = new_center_lat
                st.session_state.fulfillment_center_lng = new_center_lng
    
    # Initialize radius if not exists
    if 'fulfillment_radius_km' not in st.session_state:
        st.session_state.fulfillment_radius_km = 50.0
    
    # Create map with filtered order distribution and selected region
    map_obj = _create_order_distribution_map(aggregates)
    
    # Add center marker and circle if center is set
    if st.session_state.fulfillment_center_lat and st.session_state.fulfillment_center_lng:
        center_lat = st.session_state.fulfillment_center_lat
        center_lng = st.session_state.fulfillment_center_lng
        radius_km = st.session_state.fulfillment_radius_km
        
        # Add center marker
        folium.Marker(
            [center_lat, center_lng],
            popup=f"Center Point<br>Lat: {center_lat:.4f}<br>Lng: {center_lng:.4f}",
            icon=folium.Icon(color='red', icon='star', prefix='fa')
        ).add_to(map_obj)
        
        # Add circle showing region
        folium.Circle(
            location=[center_lat, center_lng],
            radius=radius_km * 1000,  # Convert km to meters
            popup=f"Region Radius: {radius_km} km",
            color='blue',
            fill=True,
            fillColor='blue',
            fillOpacity=0.2,
            weight=2
        ).add_to(map_obj)
    
    # Display map and capture click events
    map_data = _display_folium_map(map_obj, width=700, height=500, key="region_selection_map")
    
    # Handle map click to set center point
    # st_folium returns a dict with 'last_clicked' containing {'lat': float, 'lng': float}
    if map_data:
        last_clicked = map_data.get('last_clicked')
        if last_clicked:
            clicked_lat = last_clicked.get('lat')
            clicked_lng = last_clicked.get('lng')
            if clicked_lat is not None and clicked_lng is not None:
                # Only update if coordinates actually changed (avoid infinite rerun loop)
                if (abs(clicked_lat - st.session_state.fulfillment_center_lat) > 0.0001 or
                    abs(clicked_lng - st.session_state.fulfillment_center_lng) > 0.0001):
                    st.session_state.fulfillment_center_lat = clicked_lat
                    st.session_state.fulfillment_center_lng = clicked_lng
                    st.rerun()
    
    # Region controls
    render_fulfillment_optimizer_controls(optimizer, aggregates)


def render_fulfillment_optimizer_controls(optimizer: FulfillmentLocationOptimizer, aggregates: List[Dict]):
    """
    Render Fulfillment Optimizer controls.
    This includes center point inputs, radius, and action buttons.
    
    Args:
        optimizer: FulfillmentLocationOptimizer instance
        aggregates: Filtered coordinate aggregates
    """
    # Initialize center point in session state if not exists
    if 'fulfillment_center_lat' not in st.session_state:
        if aggregates:
            lats = [agg['latitude'] for agg in aggregates]
            lngs = [agg['longitude'] for agg in aggregates]
            st.session_state.fulfillment_center_lat = sum(lats) / len(lats) if lats else -14.235004
            st.session_state.fulfillment_center_lng = sum(lngs) / len(lngs) if lngs else -51.92528
        else:
            st.session_state.fulfillment_center_lat = -14.235004
            st.session_state.fulfillment_center_lng = -51.92528
    
    # Initialize radius if not exists
    if 'fulfillment_radius_km' not in st.session_state:
        st.session_state.fulfillment_radius_km = 50.0
    
    # Center point inputs
    col1, col2 = st.columns(2)
    with col1:
        center_lat = st.number_input(
            "Latitude",
            value=st.session_state.fulfillment_center_lat,
            min_value=-90.0,
            max_value=90.0,
            step=0.0001,
            format="%.6f",
            key="manual_center_lat"
        )
    with col2:
        center_lng = st.number_input(
            "Longitude",
            value=st.session_state.fulfillment_center_lng,
            min_value=-180.0,
            max_value=180.0,
            step=0.0001,
            format="%.6f",
            key="manual_center_lng"
        )
    
    # Update session state if manual input changed
    if (center_lat != st.session_state.fulfillment_center_lat or 
        center_lng != st.session_state.fulfillment_center_lng):
        st.session_state.fulfillment_center_lat = center_lat
        st.session_state.fulfillment_center_lng = center_lng
        st.rerun()
    
    # Radius input
    radius_km = st.number_input(
        "Radius (km)",
        value=st.session_state.fulfillment_radius_km,
        min_value=1.0,
        max_value=500.0,
        step=5.0,
        format="%.1f",
        key="radius_input",
        help="Radius in kilometers from center point (default: 50km)"
    )
    
    # Update session state if radius changed
    if radius_km != st.session_state.fulfillment_radius_km:
        st.session_state.fulfillment_radius_km = radius_km
        st.rerun()
    
    # Analyze Region button (combines Set Region + Analyze Region actions)
    if st.button("Analyze Region", type="primary", use_container_width=True):
        # First, set the region from current center and radius
        bbox = center_radius_to_bbox(center_lat, center_lng, radius_km)
        
        st.session_state.fulfillment_region = {
            'type': 'bbox',
            'bounds': bbox,
            'center': {
                'lat': center_lat,
                'lng': center_lng
            },
            'radius_km': radius_km
        }
        
        # Then analyze the region (using filtered aggregates)
        _analyze_region(optimizer, aggregates)
    
    # Clear button
    if st.button("Clear Selection", use_container_width=True):
        st.session_state.fulfillment_region = None
        st.session_state.fulfillment_order_volumes = None
        st.session_state.fulfillment_top_locations = None
        st.rerun()


def _create_order_distribution_map(aggregates: List[Dict]) -> folium.Map:
    """
    Create a map showing order distribution from filtered aggregates.
    
    Args:
        aggregates: List of filtered aggregate dictionaries
        
    Returns:
        Folium map object
    """
    if not aggregates:
        # Default to Brazil center
        center_lat, center_lng = -14.235004, -51.92528
    else:
        # Use aggregated data
        lats = [agg['latitude'] for agg in aggregates]
        lngs = [agg['longitude'] for agg in aggregates]
        weights = [agg['total_orders'] for agg in aggregates]
        
        center_lat = sum(lats) / len(lats) if lats else -14.235004
        center_lng = sum(lngs) / len(lngs) if lngs else -51.92528
    
    # Create map
    m = folium.Map(
        location=[center_lat, center_lng],
        zoom_start=4,
        tiles='OpenStreetMap'
    )
    
    # Add order clusters as heatmap
    if aggregates:
        heat_data = [[agg['latitude'], agg['longitude'], agg['total_orders']] for agg in aggregates]
        plugins.HeatMap(heat_data, radius=15, blur=10, max_zoom=1).add_to(m)
    
    return m


def _analyze_region(optimizer: FulfillmentLocationOptimizer, aggregates: List[Dict]):
    """
    Analyze selected region and find top locations using filtered aggregates.
    
    Args:
        optimizer: FulfillmentLocationOptimizer instance
        aggregates: Filtered coordinate aggregates based on current filters
    """
    region = st.session_state.fulfillment_region
    if not region:
        return
    
    try:
        if not aggregates:
            st.error("No coordinate aggregates found for the selected filters. Please adjust filters or load data first.")
            return
        
        # Convert aggregates to OrderVolumeResult format
        coordinate_clusters = []
        total_orders = 0
        total_revenue = 0.0
        unique_customers = 0
        
        for agg in aggregates:
            coordinate_clusters.append({
                'latitude': agg['latitude'],
                'longitude': agg['longitude'],
                'coordinate_key': agg['coordinate_key'],
                'total_orders': agg['total_orders'],
                'unique_customers': agg['unique_customers'],
                'total_revenue': agg['total_revenue'],
                'avg_order_value': agg['avg_order_value'],
                'first_order_date': agg.get('first_order_date'),
                'last_order_date': agg.get('last_order_date'),
                'city': agg.get('city', ''),
                'province': agg.get('province', ''),
                'country': agg.get('country', ''),
                'zip': agg.get('zip', '')
            })
            total_orders += agg['total_orders']
            total_revenue += agg['total_revenue']
            unique_customers += agg['unique_customers']
        
        # Create full OrderVolumeResult from filtered aggregates
        full_order_volumes: OrderVolumeResult = {
            'region_summary': {
                'total_orders': total_orders,
                'unique_customers': unique_customers,
                'total_revenue': total_revenue,
                'avg_order_value': total_revenue / total_orders if total_orders > 0 else 0.0,
                'coordinate_points': len(coordinate_clusters),
                'region_area_km2': None
            },
            'coordinate_clusters': coordinate_clusters
        }
        
        with st.spinner("Calculating order volume for selected region..."):
            # Calculate order volume for selected region (within filtered data)
            # Apply region filter to filtered aggregates
            region_clusters = _filter_clusters_by_region(coordinate_clusters, region)
            
            region_order_volumes: OrderVolumeResult = {
                'region_summary': {
                    'total_orders': sum(c['total_orders'] for c in region_clusters),
                    'unique_customers': sum(c['unique_customers'] for c in region_clusters),
                    'total_revenue': sum(c['total_revenue'] for c in region_clusters),
                    'avg_order_value': sum(c['total_revenue'] for c in region_clusters) / sum(c['total_orders'] for c in region_clusters) if sum(c['total_orders'] for c in region_clusters) > 0 else 0.0,
                    'coordinate_points': len(region_clusters),
                    'region_area_km2': None
                },
                'coordinate_clusters': region_clusters
            }
            st.session_state.fulfillment_order_volumes = region_order_volumes
        
        # Find top 3 locations
        with st.spinner("Finding top 3 fulfillment locations..."):
            top_locations = optimizer.find_top_fulfillment_locations(
                region,
                region_order_volumes,  # Use region-specific order volumes
                top_n=3,
                grid_resolution=0.02  # ~2km grid for faster processing
            )
            st.session_state.fulfillment_top_locations = top_locations
        
        st.success(f"Analysis complete! Found {len(top_locations)} optimal locations.")
        st.rerun()
        
    except Exception as e:
        st.error(f"Error analyzing region: {str(e)}")
        st.exception(e)


def _filter_clusters_by_region(clusters: List[Dict], region: Dict) -> List[Dict]:
    """
    Filter coordinate clusters by region boundaries.
    
    Args:
        clusters: List of coordinate cluster dictionaries
        region: Region boundaries dictionary
        
    Returns:
        Filtered list of clusters within region
    """
    if region['type'] == 'bbox':
        bounds = region['bounds']
        filtered = []
        for cluster in clusters:
            lat = cluster['latitude']
            lng = cluster['longitude']
            if (bounds['min_lat'] <= lat <= bounds['max_lat'] and
                bounds['min_lng'] <= lng <= bounds['max_lng']):
                filtered.append(cluster)
        return filtered
    else:  # polygon
        from .fulfillment_optimizer import point_in_polygon
        polygon_coords = region['coordinates']
        filtered = []
        for cluster in clusters:
            point = (cluster['latitude'], cluster['longitude'])
            if point_in_polygon(point, polygon_coords):
                filtered.append(cluster)
        return filtered


def render_results_display(optimizer: FulfillmentLocationOptimizer):
    """
    Render results display with top locations.
    
    Args:
        optimizer: FulfillmentLocationOptimizer instance
    """
    order_volumes = st.session_state.fulfillment_order_volumes
    top_locations = st.session_state.fulfillment_top_locations
    
    if not order_volumes or not top_locations:
        return
    
    # Region Summary
    render_section_header("Region Summary", "📊")
    render_region_summary(order_volumes)
    
    # Top 3 Locations
    render_section_header("Top 3 Suggested Locations", "🎯")
    
    # Display map full width
    render_top_locations_map(order_volumes, top_locations)
    
    # Location comparison
    render_location_comparison(top_locations)
    
    # Location Details
    render_section_header("Location Details", "📍")
    render_location_details(top_locations)


def render_region_summary(order_volumes: OrderVolumeResult):
    """Render region summary info box"""
    summary = order_volumes['region_summary']
    
    # Display metrics in a horizontal layout
    metric_col1, metric_col2, metric_col3, metric_col4 = st.columns(4)
    
    with metric_col1:
        st.metric("Total Orders", format_number(summary['total_orders']))
    
    with metric_col2:
        st.metric("Total Revenue", format_currency(summary['total_revenue']))
    
    with metric_col3:
        st.metric("Coordinate Points", format_number(summary['coordinate_points']))
    
    with metric_col4:
        st.metric("Unique Customers", format_number(summary['unique_customers']))


def render_top_locations_map(order_volumes: OrderVolumeResult, top_locations: List[Dict]):
    """
    Render map with top 3 locations.
    
    Args:
        order_volumes: Order volume result
        top_locations: List of top location dictionaries
    """
    if not top_locations:
        st.warning("No locations found.")
        return
    
    # Calculate map center from locations
    lats = [loc['location'][0] for loc in top_locations]
    lngs = [loc['location'][1] for loc in top_locations]
    center_lat = sum(lats) / len(lats)
    center_lng = sum(lngs) / len(lngs)
    
    # Create map
    m = folium.Map(
        location=[center_lat, center_lng],
        zoom_start=10,
        tiles='OpenStreetMap'
    )
    
    # Add order clusters as heatmap
    clusters = order_volumes['coordinate_clusters']
    if clusters:
        heat_data = [
            [cluster['latitude'], cluster['longitude'], cluster['total_orders']]
            for cluster in clusters
        ]
        plugins.HeatMap(heat_data, radius=15, blur=10, max_zoom=1).add_to(m)
    
    # Color scheme for locations
    colors = ['green', 'blue', 'orange']
    icons = ['1', '2', '3']
    
    # Add top locations with service radius circles
    for i, location_data in enumerate(top_locations):
        location = location_data['location']
        radius_km = location_data['service_radius_km']
        score = location_data['score']
        
        # Add numbered marker
        folium.Marker(
            location,
            popup=folium.Popup(
                f"""
                <b>Location #{i+1}</b><br>
                Score: {score:.1f}/100<br>
                Service Radius: {radius_km:.1f} km<br>
                Orders: {location_data['orders_in_radius']}<br>
                Routes: {location_data['estimated_routes']}
                """,
                max_width=300
            ),
            icon=folium.DivIcon(
                html=f"""
                <div style="
                    background-color: {colors[i]};
                    color: white;
                    width: 30px;
                    height: 30px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: bold;
                    border: 2px solid white;
                ">{icons[i]}</div>
                """,
                icon_size=(30, 30),
                icon_anchor=(15, 15)
            )
        ).add_to(m)
        
        # Add service radius circle
        folium.Circle(
            location,
            radius=radius_km * 1000,  # Convert km to meters
            popup=f"Service Radius: {radius_km:.1f} km",
            color=colors[i],
            fill=True,
            fillOpacity=0.2,
            weight=2
        ).add_to(m)
    
    # Add legend
    legend_html = """
    <div style="position: fixed; bottom: 50px; right: 50px; z-index:1000; background-color: white; padding: 10px; border: 2px solid grey; border-radius: 5px;">
    <h4>Locations</h4>
    <p><span style="color: green;">●</span> Location #1 (Highest Score)</p>
    <p><span style="color: blue;">●</span> Location #2</p>
    <p><span style="color: orange;">●</span> Location #3</p>
    </div>
    """
    m.get_root().html.add_child(folium.Element(legend_html))
    
    # Display map
    _display_folium_map(m, width=700, height=500, key="top_locations_map")


def render_location_comparison(top_locations: List[Dict]):
    """Render location comparison table"""
    render_subsection_header("Quick Comparison")
    
    if not top_locations:
        return
    
    # Prepare comparison data
    comparison_data = []
    for i, loc in enumerate(top_locations):
        comparison_data.append({
            'Location': f"#{i+1}",
            'Score': f"{loc['score']:.1f}",
            'Radius (km)': f"{loc['service_radius_km']:.1f}",
            'Orders': loc['orders_in_radius'],
            'Routes': loc['estimated_routes'],
            'Avg Distance (km)': f"{loc['avg_delivery_distance_km']:.1f}",
            'Revenue (R$)': format_currency(loc['total_revenue_in_radius'])
        })
    
    comparison_df = pd.DataFrame(comparison_data)
    st.dataframe(comparison_df, use_container_width=True, hide_index=True)


def render_location_details(top_locations: List[Dict]):
    """Render detailed metrics for each location"""
    for i, location_data in enumerate(top_locations):
        with st.expander(f"Location #{i+1} - Score: {location_data['score']:.1f}/100", expanded=(i == 0)):
            # Use columns for layout
            col1, col2 = st.columns(2)
            
            with col1:
                st.caption("**Location Coordinates**")
                st.write(f"Latitude: {location_data['location'][0]:.6f}")
                st.write(f"Longitude: {location_data['location'][1]:.6f}")
                
                st.caption("**Service Metrics**")
                st.metric("Service Radius", f"{location_data['service_radius_km']:.1f} km")
                st.metric("Orders in Radius", location_data['orders_in_radius'])
                st.metric("Coordinate Points", location_data['coordinate_points_in_radius'])
                st.metric("Estimated Routes", location_data['estimated_routes'])
                st.metric("Orders per Route", f"{location_data['orders_per_route']:.1f}")
            
            with col2:
                st.caption("**Factor Scores**")
                factor_scores = location_data['factor_scores']
                st.metric("Distance Score", f"{factor_scores['distance_score']:.1f}/100")
                st.metric("Volume Score", f"{factor_scores['volume_score']:.1f}/100")
                st.metric("Efficiency Score", f"{factor_scores['efficiency_score']:.1f}/100")
                
                st.caption("**Financial Metrics**")
                st.metric("Total Revenue", format_currency(location_data['total_revenue_in_radius']))
                st.metric("Avg Delivery Distance", f"{location_data['avg_delivery_distance_km']:.1f} km")
                st.metric("Coverage Score", f"{location_data['coverage_score']:.1f}/100")


# Helper function to display Folium maps in Streamlit
def _display_folium_map(m: folium.Map, width: int = 700, height: int = 500, key: str = None):
    """
    Display Folium map in Streamlit.
    
    Args:
        m: Folium map object
        width: Map width in pixels
        height: Map height in pixels
        key: Unique key for Streamlit component
    """
    try:
        from streamlit_folium import st_folium
        return st_folium(m, width=width, height=height, key=key)
    except ImportError:
        # Fallback: convert to HTML and display
        st.components.v1.html(m._repr_html_(), width=width, height=height)
        return None


