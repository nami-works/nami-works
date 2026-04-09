"""
Fulfillment Location Optimizer

This module provides algorithms for calculating order volume by coordinates within
geographic regions and optimizing fulfillment center locations.

Features:
- Order volume calculation by region (bounding box or polygon)
- Fulfillment location scoring (distance, volume, efficiency, coverage)
- Top 3 location selection with geographic diversity
- Route efficiency optimization (5-15 orders per route)
- Performance optimizations (caching, vectorized operations, binary search)

Usage:
    from functions.local_delivery.fulfillment_optimizer.fulfillment_optimizer import (
        FulfillmentLocationOptimizer,
        RegionBoundaries
    )
    
    optimizer = FulfillmentLocationOptimizer()
    
    # Define region
    region: RegionBoundaries = {
        'type': 'bbox',
        'bounds': {
            'min_lat': -25.0,
            'max_lat': -23.0,
            'min_lng': -47.0,
            'max_lng': -45.0
        }
    }
    
    # Calculate order volume
    order_volumes = optimizer.calculate_order_volume_by_region(region)
    
    # Find top 3 locations
    top_locations = optimizer.find_top_fulfillment_locations(
        region,
        order_volumes,
        top_n=3
    )

Performance:
- Region calculation: < 5 seconds (typical region)
- Location scoring: < 10 seconds (100 candidates)
- Top 3 selection: < 2 seconds
- Total execution: < 20 seconds

Author: CPG Labs GeoCommerce Team
Date: 2024-12-19
"""

from typing import Dict, List, Tuple, Optional, Union, TypedDict
from dataclasses import dataclass
import logging
import hashlib
import json
import time
import math
from collections import OrderedDict
from functools import lru_cache
import pandas as pd
import numpy as np

from functions.geocommerce.coordinate_storage import CoordinateStorage
from functions.shared.coordinate_utils import validate_coordinates

logger = logging.getLogger(__name__)


# ============================================================================
# Data Structure Definitions
# ============================================================================

class BoundingBoxBounds(TypedDict):
    """Bounding box coordinate bounds"""
    min_lat: float
    max_lat: float
    min_lng: float
    max_lng: float


class BoundingBoxRegion(TypedDict):
    """Bounding box region definition"""
    type: str  # Literal['bbox']
    bounds: BoundingBoxBounds


class PolygonRegion(TypedDict):
    """Polygon region definition"""
    type: str  # Literal['polygon']
    coordinates: List[Tuple[float, float]]  # List of (lat, lng) points


# Union type for region boundaries
RegionBoundaries = Union[BoundingBoxRegion, PolygonRegion]


class CoordinateCluster(TypedDict):
    """Coordinate cluster data structure"""
    latitude: float
    longitude: float
    coordinate_key: str
    total_orders: int
    unique_customers: int
    total_revenue: float
    avg_order_value: float
    first_order_date: Optional[str]
    last_order_date: Optional[str]
    city: str
    province: str
    country: str
    zip: str


class RegionSummary(TypedDict):
    """Summary statistics for a region"""
    total_orders: int
    unique_customers: int
    total_revenue: float
    avg_order_value: float
    coordinate_points: int
    region_area_km2: Optional[float]  # To be implemented in Phase 2


class OrderVolumeResult(TypedDict):
    """Result structure for order volume calculation"""
    region_summary: RegionSummary
    coordinate_clusters: List[CoordinateCluster]


# ============================================================================
# Region Validation
# ============================================================================

def validate_region_boundaries(region_boundaries: RegionBoundaries) -> bool:
    """
    Validate region boundaries structure and values.
    
    Args:
        region_boundaries: Region boundaries in bbox or polygon format
        
    Returns:
        True if valid
        
    Raises:
        ValueError: If region boundaries are invalid
    """
    if region_boundaries['type'] == 'bbox':
        bounds = region_boundaries['bounds']
        min_lat = bounds['min_lat']
        max_lat = bounds['max_lat']
        min_lng = bounds['min_lng']
        max_lng = bounds['max_lng']
        
        # Check bounds ordering
        if not (min_lat < max_lat and min_lng < max_lng):
            raise ValueError("Invalid bounding box: min must be less than max")
        
        # Check coordinate ranges
        if not (-90 <= min_lat <= 90 and -90 <= max_lat <= 90):
            raise ValueError("Latitude out of range (-90 to 90)")
        
        if not (-180 <= min_lng <= 180 and -180 <= max_lng <= 180):
            raise ValueError("Longitude out of range (-180 to 180)")
        
        return True
    
    elif region_boundaries['type'] == 'polygon':
        coordinates = region_boundaries['coordinates']
        
        # Check minimum points
        if len(coordinates) < 3:
            raise ValueError("Polygon must have at least 3 points")
        
        # Check if polygon is closed
        if coordinates[0] != coordinates[-1]:
            raise ValueError("Polygon must be closed (first point must equal last point)")
        
        # Validate each coordinate
        for i, point in enumerate(coordinates):
            if not isinstance(point, tuple) or len(point) != 2:
                raise ValueError(f"Invalid point format at index {i}: expected tuple of (lat, lng)")
            
            lat, lng = point
            if not validate_coordinates(lat, lng):
                raise ValueError(f"Invalid coordinates at index {i}: ({lat}, {lng})")
        
        return True
    
    else:
        raise ValueError(f"Unknown region type: {region_boundaries.get('type')}")


# ============================================================================
# Point-in-Polygon Algorithm (Ray-Casting)
# ============================================================================

def _batch_point_in_polygon(
    aggregates: List[Dict],
    polygon_coordinates: List[Tuple[float, float]]
) -> List[Dict]:
    """
    Batch point-in-polygon check for multiple points.
    
    This is more efficient than checking points one-by-one.
    
    Args:
        aggregates: List of aggregate dictionaries with latitude/longitude
        polygon_coordinates: Polygon coordinates
        
    Returns:
        Filtered list of aggregates within polygon
    """
    filtered = []
    for agg in aggregates:
        point = (agg['latitude'], agg['longitude'])
        if point_in_polygon(point, polygon_coordinates):
            filtered.append(agg)
    return filtered


def point_in_polygon(point: Tuple[float, float], polygon_coordinates: List[Tuple[float, float]]) -> bool:
    """
    Check if a point is inside a polygon using ray-casting algorithm (even-odd rule).
    
    Args:
        point: Tuple of (latitude, longitude)
        polygon_coordinates: List of (lat, lng) tuples forming a closed polygon
        
    Returns:
        True if point is inside polygon, False otherwise
    """
    lat, lng = point
    
    # Ensure polygon is closed
    if polygon_coordinates[0] != polygon_coordinates[-1]:
        polygon = polygon_coordinates + [polygon_coordinates[0]]
    else:
        polygon = polygon_coordinates
    
    intersections = 0
    n = len(polygon) - 1
    
    for i in range(n):
        p1_lat, p1_lng = polygon[i]
        p2_lat, p2_lng = polygon[i + 1]
        
        # Check if edge crosses the horizontal ray from point
        # Ray extends eastward from point at latitude = lat
        if (p1_lat > lat) != (p2_lat > lat):
            # Calculate longitude of intersection using linear interpolation
            if p2_lat != p1_lat:  # Avoid division by zero
                intersection_lng = p1_lng + (lat - p1_lat) * (p2_lng - p1_lng) / (p2_lat - p1_lat)
                
                # Count intersection if it's to the right of the point
                if intersection_lng > lng:
                    intersections += 1
    
    # Odd intersections = inside, even = outside
    return (intersections % 2) == 1


def calculate_polygon_bounds(polygon_coordinates: List[Tuple[float, float]]) -> BoundingBoxBounds:
    """
    Calculate bounding box for a polygon.
    
    Args:
        polygon_coordinates: List of (lat, lng) tuples
        
    Returns:
        Bounding box bounds
    """
    lats = [p[0] for p in polygon_coordinates]
    lngs = [p[1] for p in polygon_coordinates]
    
    return {
        'min_lat': min(lats),
        'max_lat': max(lats),
        'min_lng': min(lngs),
        'max_lng': max(lngs)
    }


# ============================================================================
# Order Volume Calculation
# ============================================================================

class RegionCalculationCache:
    """
    LRU cache for region calculations with TTL support.
    
    Implements hash-based caching with TTL expiration and LRU eviction.
    """
    
    def __init__(self, max_size: int = 100, ttl_seconds: int = 3600):
        """
        Initialize the cache.
        
        Args:
            max_size: Maximum number of cached entries (LRU eviction)
            ttl_seconds: Time-to-live in seconds (default: 1 hour)
        """
        self.max_size = max_size
        self.ttl_seconds = ttl_seconds
        self._cache: OrderedDict[str, Tuple[float, Dict]] = OrderedDict()
    
    def _create_key(self, region_boundaries: RegionBoundaries, filters: Optional[Dict]) -> str:
        """Create a hash key from region boundaries and filters"""
        # Create a stable representation for hashing
        cache_data = {
            'region': region_boundaries,
            'filters': filters or {}
        }
        cache_str = json.dumps(cache_data, sort_keys=True, default=str)
        return hashlib.sha256(cache_str.encode()).hexdigest()
    
    def get(self, region_boundaries: RegionBoundaries, filters: Optional[Dict]) -> Optional[Dict]:
        """
        Get cached result if available and not expired.
        
        Args:
            region_boundaries: Region boundaries
            filters: Optional filters
            
        Returns:
            Cached result or None if not found/expired
        """
        key = self._create_key(region_boundaries, filters)
        
        if key not in self._cache:
            return None
        
        # Check TTL
        timestamp, result = self._cache[key]
        if time.time() - timestamp > self.ttl_seconds:
            # Expired, remove it
            del self._cache[key]
            return None
        
        # Move to end (most recently used)
        self._cache.move_to_end(key)
        return result
    
    def set(self, region_boundaries: RegionBoundaries, filters: Optional[Dict], result: Dict):
        """
        Cache a result.
        
        Args:
            region_boundaries: Region boundaries
            filters: Optional filters
            result: Result to cache
        """
        key = self._create_key(region_boundaries, filters)
        
        # Remove if exists
        if key in self._cache:
            del self._cache[key]
        
        # Add new entry
        self._cache[key] = (time.time(), result)
        
        # Evict oldest if over limit
        if len(self._cache) > self.max_size:
            self._cache.popitem(last=False)
    
    def clear(self):
        """Clear all cached entries"""
        self._cache.clear()
    
    def get_stats(self) -> Dict[str, int]:
        """Get cache statistics"""
        return {
            'size': len(self._cache),
            'max_size': self.max_size,
            'ttl_seconds': self.ttl_seconds
        }


class FulfillmentLocationOptimizer:
    """
    Optimizer for calculating order volume within geographic regions.
    
    Phase 1: Order volume calculation algorithm
    Phase 2: Fulfillment location scoring and selection (future)
    """
    
    def __init__(
        self,
        coordinate_storage: Optional[CoordinateStorage] = None,
        enable_caching: bool = True,
        cache_ttl: int = 3600,
        enable_scoring_cache: bool = True,
        scoring_cache_ttl: int = 1800
    ):
        """
        Initialize the optimizer.
        
        Args:
            coordinate_storage: CoordinateStorage instance. If None, creates new instance.
            enable_caching: Enable region calculation caching (default: True)
            cache_ttl: Cache TTL in seconds (default: 3600 = 1 hour)
            enable_scoring_cache: Enable location scoring cache (default: True)
            scoring_cache_ttl: Scoring cache TTL in seconds (default: 1800 = 30 minutes)
        """
        self.coordinate_storage = coordinate_storage or CoordinateStorage()
        self.boundary_buffer = 0.001  # ~100 meters (matches coordinate precision)
        self.enable_caching = enable_caching
        if enable_caching:
            self.region_cache = RegionCalculationCache(ttl_seconds=cache_ttl)
        else:
            self.region_cache = None
        
        self.enable_scoring_cache = enable_scoring_cache
        if enable_scoring_cache:
            self.scoring_cache = LocationScoreCache(ttl_seconds=scoring_cache_ttl)
        else:
            self.scoring_cache = None
    
    def calculate_order_volume_by_region(
        self,
        region_boundaries: RegionBoundaries,
        filters: Optional[Dict] = None,
        include_boundary_buffer: bool = True
    ) -> OrderVolumeResult:
        """
        Calculate order volume by coordinates within a region.
        
        This is the main algorithm specified in the design document.
        Uses caching for performance optimization.
        
        Args:
            region_boundaries: Region boundaries (bbox or polygon)
            filters: Optional filters (date_from, date_to, city, province, country)
            include_boundary_buffer: Include 100m buffer around boundaries (default: True)
            
        Returns:
            OrderVolumeResult with region summary and coordinate clusters
            
        Raises:
            ValueError: If region boundaries are invalid
        """
        # Step 1: Validate region boundaries
        validate_region_boundaries(region_boundaries)
        
        # Check cache first
        if self.enable_caching and self.region_cache:
            cached_result = self.region_cache.get(region_boundaries, filters)
            if cached_result is not None:
                logger.debug("Cache hit for region calculation")
                return cached_result
        
        # Step 2: Query coordinate aggregates
        if region_boundaries['type'] == 'bbox':
            filtered_aggregates = self._query_bbox_region(
                region_boundaries['bounds'],
                filters,
                include_boundary_buffer
            )
        else:  # polygon
            filtered_aggregates = self._query_polygon_region(
                region_boundaries['coordinates'],
                filters,
                include_boundary_buffer
            )
        
        # Step 3: Aggregate results
        result = self._aggregate_results(filtered_aggregates)
        
        # Cache result
        if self.enable_caching and self.region_cache:
            self.region_cache.set(region_boundaries, filters, result)
        
        return result
    
    def _query_bbox_region(
        self,
        bounds: BoundingBoxBounds,
        filters: Optional[Dict],
        include_buffer: bool
    ) -> List[Dict]:
        """
        Query coordinate aggregates within bounding box.
        
        Uses optimized database query with indexed WHERE clause for performance.
        
        Args:
            bounds: Bounding box bounds
            filters: Optional filters
            include_buffer: Include boundary buffer
            
        Returns:
            List of aggregate dictionaries
        """
        # Apply buffer if requested
        buffer = self.boundary_buffer if include_buffer else 0.0
        
        min_lat = bounds['min_lat'] - buffer
        max_lat = bounds['max_lat'] + buffer
        min_lng = bounds['min_lng'] - buffer
        max_lng = bounds['max_lng'] + buffer
        
        # Build filter dict for coordinate_storage
        storage_filters = filters.copy() if filters else {}
        
        # Use optimized bbox query method (uses indexed SQL query)
        return self.coordinate_storage.get_coordinate_aggregates_by_bbox(
            min_lat=min_lat,
            max_lat=max_lat,
            min_lng=min_lng,
            max_lng=max_lng,
            filters=storage_filters
        )
    
    def _query_polygon_region(
        self,
        polygon_coordinates: List[Tuple[float, float]],
        filters: Optional[Dict],
        include_buffer: bool
    ) -> List[Dict]:
        """
        Query coordinate aggregates within polygon.
        
        Uses optimized two-step process:
        1. Quick bounding box filter (uses indexed SQL query)
        2. Batch point-in-polygon check
        
        Args:
            polygon_coordinates: Polygon coordinates
            filters: Optional filters
            include_buffer: Include boundary buffer
            
        Returns:
            List of aggregate dictionaries
        """
        # Step 1: Calculate polygon bounding box
        polygon_bounds = calculate_polygon_bounds(polygon_coordinates)
        
        # Apply buffer if requested (to bbox for initial filter)
        buffer = self.boundary_buffer if include_buffer else 0.0
        
        # Step 2: Query aggregates in polygon's bounding box (optimized query)
        bbox_aggregates = self._query_bbox_region(
            polygon_bounds,
            filters,
            include_buffer=True  # Apply buffer to bbox for initial filter
        )
        
        # Step 3: Batch point-in-polygon check
        # Filter coordinates that are within polygon
        if len(bbox_aggregates) > 20:  # Use batch processing for larger datasets
            filtered = _batch_point_in_polygon(bbox_aggregates, polygon_coordinates)
        else:
            # For small datasets, use simple loop (lower overhead)
            filtered = []
            for agg in bbox_aggregates:
                point = (agg['latitude'], agg['longitude'])
                if point_in_polygon(point, polygon_coordinates):
                    filtered.append(agg)
        
        return filtered
    
    def invalidate_cache(self):
        """
        Invalidate all cached region calculations.
        
        Call this when new orders are added to ensure fresh calculations.
        """
        if self.region_cache:
            self.region_cache.clear()
            logger.info("Region calculation cache cleared")
    
    def get_cache_stats(self) -> Optional[Dict[str, int]]:
        """
        Get cache statistics.
        
        Returns:
            Dictionary with cache stats or None if caching disabled
        """
        if self.region_cache:
            return self.region_cache.get_stats()
        return None
    
    def invalidate_scoring_cache(self):
        """
        Invalidate all cached location scores.
        
        Call this when order volumes change to ensure fresh scores.
        """
        if self.scoring_cache:
            self.scoring_cache.clear()
            logger.info("Location scoring cache cleared")
    
    def get_scoring_cache_stats(self) -> Optional[Dict[str, int]]:
        """
        Get scoring cache statistics.
        
        Returns:
            Dictionary with cache stats or None if caching disabled
        """
        if self.scoring_cache:
            return self.scoring_cache.get_stats()
        return None
    
    # ============================================================================
    # Scoring Algorithm Methods
    # ============================================================================
    
    def calculate_service_radius(
        self,
        location: Tuple[float, float],
        order_clusters: List[CoordinateCluster],
        min_orders_per_route: int = 5,
        max_orders_per_route: int = 15,
        max_radius_km: float = 50.0
    ) -> float:
        """
        Calculate optimal service radius for multi-stop routes.
        
        Uses binary search for optimal performance (O(log n) instead of O(n)).
        
        Args:
            location: Candidate location (lat, lng)
            order_clusters: List of coordinate clusters with order data
            min_orders_per_route: Minimum orders per route (default: 5)
            max_orders_per_route: Maximum orders per route (default: 15)
            max_radius_km: Maximum service radius (default: 50km)
            
        Returns:
            Optimal service radius in kilometers
        """
        if not order_clusters:
            return 5.0  # Minimum radius
        
        # Use binary search for better performance
        return self._calculate_service_radius_binary_search(
            location,
            order_clusters,
            min_orders_per_route,
            max_orders_per_route,
            max_radius_km
        )
    
    def _calculate_service_radius_binary_search(
        self,
        location: Tuple[float, float],
        order_clusters: List[CoordinateCluster],
        min_orders_per_route: int,
        max_orders_per_route: int,
        max_radius_km: float
    ) -> float:
        """
        Calculate optimal service radius using binary search.
        
        This is more efficient than incremental expansion, especially for
        large datasets with many order clusters.
        """
        def get_orders_per_route(radius: float) -> float:
            """Helper function to calculate orders per route for a given radius"""
            orders_in_radius = get_orders_within_radius(
                location,
                order_clusters,
                radius
            )
            if not orders_in_radius:
                return 0.0
            
            total_orders = sum(cluster['total_orders'] for cluster in orders_in_radius)
            estimated_routes = math.ceil(total_orders / max_orders_per_route)
            return total_orders / estimated_routes if estimated_routes > 0 else 0.0
        
        # Binary search
        left, right = 1.0, max_radius_km
        best_radius = left
        precision_km = 0.5  # 0.5km precision
        
        while right - left > precision_km:
            mid = (left + right) / 2
            orders_per_route = get_orders_per_route(mid)
            
            if min_orders_per_route <= orders_per_route <= max_orders_per_route:
                # Within optimal range - try smaller radius to find minimum optimal
                best_radius = mid
                right = mid
            elif orders_per_route < min_orders_per_route:
                # Too few orders - need larger radius
                left = mid
            else:
                # Too many orders - need smaller radius
                right = mid
        
        return best_radius
    
    def _calculate_weighted_avg_distance(
        self,
        location: Tuple[float, float],
        order_clusters: List[CoordinateCluster]
    ) -> float:
        """
        Calculate weighted average distance from location to order clusters.
        
        Uses vectorized batch calculation for better performance.
        
        Args:
            location: Location coordinates
            order_clusters: List of coordinate clusters
            
        Returns:
            Weighted average distance in kilometers
        """
        if not order_clusters:
            return 0.0
        
        # Use vectorized calculation for better performance
        if len(order_clusters) > 10:
            # Vectorized version
            location_array = np.array([location[0], location[1]])
            cluster_coords = np.array([
                [cluster['latitude'], cluster['longitude']] 
                for cluster in order_clusters
            ])
            order_counts = np.array([cluster['total_orders'] for cluster in order_clusters])
            
            distances = batch_haversine_distance(location_array, cluster_coords)
            weighted_sum = np.sum(distances * order_counts)
            total_weight = np.sum(order_counts)
            
            return float(weighted_sum / total_weight) if total_weight > 0 else 0.0
        else:
            # Simple loop for small datasets
            total_weight = 0
            weighted_sum = 0.0
            
            for cluster in order_clusters:
                cluster_location = (cluster['latitude'], cluster['longitude'])
                distance = cached_haversine_distance(
                    location[0], location[1],
                    cluster_location[0], cluster_location[1]
                )
                order_count = cluster['total_orders']
                
                weighted_sum += distance * order_count
                total_weight += order_count
            
            if total_weight == 0:
                return 0.0
            
            return weighted_sum / total_weight
    
    def _calculate_distance_score(
        self,
        location: Tuple[float, float],
        orders_in_radius: List[CoordinateCluster],
        service_radius_km: float
    ) -> float:
        """
        Calculate distance factor score (0-100).
        
        Args:
            location: Candidate location
            orders_in_radius: Order clusters within service radius
            service_radius_km: Service radius in kilometers
            
        Returns:
            Distance score (0-100, higher is better)
        """
        if not orders_in_radius:
            return 0.0
        
        weighted_avg_distance = self._calculate_weighted_avg_distance(
            location,
            orders_in_radius
        )
        
        # Score: 100 = 0km distance, 0 = max_radius distance
        # Use exponential decay for better differentiation
        max_distance = service_radius_km
        normalized_distance = min(weighted_avg_distance / max_distance, 1.0)
        
        # Exponential decay: score = 100 * e^(-2 * normalized_distance)
        score = 100 * math.exp(-2 * normalized_distance)
        
        return score
    
    def _calculate_volume_score(
        self,
        orders_in_radius: List[CoordinateCluster],
        service_radius_km: float,
        region_total_orders: int
    ) -> float:
        """
        Calculate volume factor score (0-100).
        
        Args:
            orders_in_radius: Order clusters within service radius
            service_radius_km: Service radius in kilometers
            region_total_orders: Total orders in region
            
        Returns:
            Volume score (0-100, higher is better)
        """
        if not orders_in_radius:
            return 0.0
        
        total_orders = sum(cluster['total_orders'] for cluster in orders_in_radius)
        
        # Calculate order density (orders per km²)
        service_area_km2 = math.pi * service_radius_km ** 2
        order_density = total_orders / service_area_km2 if service_area_km2 > 0 else 0
        
        # Normalize against region total (what % of region orders are in radius)
        order_coverage = total_orders / region_total_orders if region_total_orders > 0 else 0
        
        # Score components (each 0-100, weighted)
        density_score = min(100, order_density * 10)  # Scale: 10 orders/km² = 100 points
        coverage_score = order_coverage * 100         # % of region orders
        
        # Combined score (weighted average)
        # Density: 60%, Coverage: 40%
        score = (density_score * 0.6) + (coverage_score * 0.4)
        
        return score
    
    def _calculate_route_efficiency_score(
        self,
        orders_in_radius: List[CoordinateCluster],
        service_radius_km: float,
        min_orders_per_route: int = 5,
        max_orders_per_route: int = 15
    ) -> Dict[str, float]:
        """
        Calculate route efficiency score (0-100).
        
        Args:
            orders_in_radius: Order clusters within service radius
            service_radius_km: Service radius in kilometers
            min_orders_per_route: Minimum orders per route
            max_orders_per_route: Maximum orders per route
            
        Returns:
            Dictionary with efficiency_score, orders_per_route, estimated_routes
        """
        if not orders_in_radius:
            return {
                'efficiency_score': 0.0,
                'orders_per_route': 0.0,
                'estimated_routes': 0
            }
        
        total_orders = sum(cluster['total_orders'] for cluster in orders_in_radius)
        
        # Estimate number of routes needed
        estimated_routes = math.ceil(total_orders / max_orders_per_route)
        orders_per_route = total_orders / estimated_routes if estimated_routes > 0 else 0
        
        # Score based on how close orders_per_route is to optimal range
        optimal_min = min_orders_per_route
        optimal_max = max_orders_per_route
        optimal_center = (optimal_min + optimal_max) / 2  # 10 orders per route
        
        if orders_per_route < optimal_min:
            # Too few orders per route - inefficient
            score = (orders_per_route / optimal_min) * 50  # Max 50 points
        
        elif orders_per_route > optimal_max:
            # Too many orders per route - may need more routes
            excess = orders_per_route - optimal_max
            max_excess = optimal_max  # Allow up to 2x optimal_max before score = 0
            score = max(0, 100 - (excess / max_excess) * 100)
        
        else:
            # Within optimal range - score based on distance from center
            distance_from_center = abs(orders_per_route - optimal_center)
            max_distance = (optimal_max - optimal_min) / 2  # Distance to edge
            normalized_distance = distance_from_center / max_distance if max_distance > 0 else 0
            score = 100 * (1 - normalized_distance * 0.3)  # Max 30% reduction at edges
        
        return {
            'efficiency_score': score,
            'orders_per_route': orders_per_route,
            'estimated_routes': estimated_routes
        }
    
    def _calculate_coverage_score(
        self,
        orders_in_radius: List[CoordinateCluster],
        service_radius_km: float
    ) -> float:
        """
        Calculate geographic coverage score (0-100).
        
        Args:
            orders_in_radius: Order clusters within service radius
            service_radius_km: Service radius in kilometers
            
        Returns:
            Coverage score (0-100, higher is better spread)
        """
        if len(orders_in_radius) < 2:
            return 50.0  # Neutral score for single point
        
        # Calculate spread of orders
        # Use standard deviation of distances from center
        center_lat = sum(cluster['latitude'] for cluster in orders_in_radius) / len(orders_in_radius)
        center_lng = sum(cluster['longitude'] for cluster in orders_in_radius) / len(orders_in_radius)
        center = (center_lat, center_lng)
        
        distances = []
        for cluster in orders_in_radius:
            cluster_location = (cluster['latitude'], cluster['longitude'])
            distance = haversine_distance(center, cluster_location)
            distances.append(distance)
        
        # Calculate coefficient of variation (std / mean)
        mean_distance = sum(distances) / len(distances) if distances else 0
        
        if mean_distance == 0:
            return 0.0
        
        variance = sum((d - mean_distance) ** 2 for d in distances) / len(distances)
        std_distance = math.sqrt(variance)
        coefficient_of_variation = std_distance / mean_distance
        
        # Score: 0-100 based on variation
        # Good spread: CV > 0.5, Poor spread: CV < 0.2
        score = min(100, coefficient_of_variation * 200)
        
        return score
    
    def score_fulfillment_location(
        self,
        location: Tuple[float, float],
        order_volumes_result: OrderVolumeResult,
        region_boundaries: RegionBoundaries,
        min_orders_per_route: int = 5,
        max_orders_per_route: int = 15,
        max_service_radius_km: float = 50.0,
        distance_weight: float = 0.4,
        volume_weight: float = 0.4,
        efficiency_weight: float = 0.2
    ) -> Dict:
        """
        Score a potential fulfillment location.
        
        Args:
            location: Candidate location (lat, lng)
            order_volumes_result: Result from calculate_order_volume_by_region()
            region_boundaries: Region boundaries
            min_orders_per_route: Minimum orders per route (default: 5)
            max_orders_per_route: Maximum orders per route (default: 15)
            max_service_radius_km: Maximum service radius (default: 50km)
            distance_weight: Weight for distance factor (default: 0.4)
            volume_weight: Weight for volume factor (default: 0.4)
            efficiency_weight: Weight for efficiency factor (default: 0.2)
            
        Returns:
            Dictionary with location score and metrics
        """
        # Validate weights sum to 1.0
        total_weight = distance_weight + volume_weight + efficiency_weight
        if abs(total_weight - 1.0) > 0.001:
            raise ValueError(f"Weights must sum to 1.0, got {total_weight}")
        
        # Check cache
        if self.enable_scoring_cache and self.scoring_cache:
            # Create hash of order volumes for cache key
            order_clusters = order_volumes_result['coordinate_clusters']
            order_hash = hashlib.sha256(
                json.dumps(
                    [(c['latitude'], c['longitude'], c['total_orders']) for c in order_clusters],
                    sort_keys=True
                ).encode()
            ).hexdigest()
            
            cached_result = self.scoring_cache.get(location, order_hash)
            if cached_result is not None:
                logger.debug("Cache hit for location score")
                return cached_result
        
        order_clusters = order_volumes_result['coordinate_clusters']
        region_total_orders = order_volumes_result['region_summary']['total_orders']
        
        # Step 1: Calculate service radius
        service_radius = self.calculate_service_radius(
            location,
            order_clusters,
            min_orders_per_route,
            max_orders_per_route,
            max_service_radius_km
        )
        
        # Step 2: Get orders within service radius
        orders_in_radius = get_orders_within_radius(
            location,
            order_clusters,
            service_radius
        )
        
        # Step 3: Calculate factor scores
        distance_score = self._calculate_distance_score(
            location,
            orders_in_radius,
            service_radius
        )
        
        volume_score = self._calculate_volume_score(
            orders_in_radius,
            service_radius,
            region_total_orders
        )
        
        efficiency_data = self._calculate_route_efficiency_score(
            orders_in_radius,
            service_radius,
            min_orders_per_route,
            max_orders_per_route
        )
        
        coverage_score = self._calculate_coverage_score(
            orders_in_radius,
            service_radius
        )
        
        # Step 4: Calculate weighted overall score
        overall_score = (
            distance_score * distance_weight +
            volume_score * volume_weight +
            efficiency_data['efficiency_score'] * efficiency_weight
        )
        
        # Step 5: Calculate additional metrics
        avg_distance = self._calculate_weighted_avg_distance(location, orders_in_radius)
        total_revenue = sum(cluster['total_revenue'] for cluster in orders_in_radius)
        total_orders = sum(cluster['total_orders'] for cluster in orders_in_radius)
        
        result = {
            'location': location,
            'score': overall_score,
            'service_radius_km': service_radius,
            'orders_in_radius': total_orders,
            'coordinate_points_in_radius': len(orders_in_radius),
            'avg_delivery_distance_km': avg_distance,
            'total_revenue_in_radius': total_revenue,
            'route_efficiency_score': efficiency_data['efficiency_score'],
            'orders_per_route': efficiency_data['orders_per_route'],
            'estimated_routes': efficiency_data['estimated_routes'],
            'coverage_score': coverage_score,
            'factor_scores': {
                'distance_score': distance_score,
                'volume_score': volume_score,
                'efficiency_score': efficiency_data['efficiency_score']
            }
        }
        
        # Cache result
        if self.enable_scoring_cache and self.scoring_cache:
            order_hash = hashlib.sha256(
                json.dumps(
                    [(c['latitude'], c['longitude'], c['total_orders']) for c in order_clusters],
                    sort_keys=True
                ).encode()
            ).hexdigest()
            self.scoring_cache.set(location, order_hash, result)
        
        return result
    
    def generate_candidate_locations(
        self,
        region_boundaries: RegionBoundaries,
        order_volumes_result: OrderVolumeResult,
        grid_resolution: float = 0.01  # ~1km grid
    ) -> List[Tuple[float, float]]:
        """
        Generate candidate fulfillment locations within region.
        
        Generates a grid of candidate locations, prioritizing areas with high order density.
        
        Args:
            region_boundaries: Region boundaries (bbox or polygon)
            order_volumes_result: Result from calculate_order_volume_by_region()
            grid_resolution: Grid resolution in degrees (default: 0.01 ≈ 1km)
            
        Returns:
            List of candidate locations (lat, lng) tuples
        """
        logger.debug(f"Generating candidates for region type: {region_boundaries['type']}")
        order_clusters = order_volumes_result['coordinate_clusters']
        logger.debug(f"Order clusters available: {len(order_clusters)}")
        
        if not order_clusters:
            logger.warning("No order clusters available for candidate generation. "
                          "Generating grid candidates based on region boundaries only.")
            # No orders - generate grid based on region boundaries only
            if region_boundaries['type'] == 'bbox':
                bounds = region_boundaries['bounds']
                candidates = []
                lat = bounds['min_lat']
                while lat <= bounds['max_lat']:
                    lng = bounds['min_lng']
                    while lng <= bounds['max_lng']:
                        candidates.append((lat, lng))
                        lng += grid_resolution
                    lat += grid_resolution
                logger.info(f"Generated {len(candidates)} grid candidates for empty region (bbox)")
                return candidates
            else:
                # For polygon, use bounding box
                polygon_bounds = calculate_polygon_bounds(region_boundaries['coordinates'])
                candidates = []
                lat = polygon_bounds['min_lat']
                while lat <= polygon_bounds['max_lat']:
                    lng = polygon_bounds['min_lng']
                    while lng <= polygon_bounds['max_lng']:
                        point = (lat, lng)
                        if point_in_polygon(point, region_boundaries['coordinates']):
                            candidates.append(point)
                        lng += grid_resolution
                    lat += grid_resolution
                logger.info(f"Generated {len(candidates)} grid candidates for empty region (polygon)")
                return candidates
        
        # Prioritize areas with high order density
        candidates = []
        
        # Add candidates at order cluster locations (high priority)
        for cluster in order_clusters:
            candidates.append((cluster['latitude'], cluster['longitude']))
        
        # Add grid candidates around high-density areas
        if region_boundaries['type'] == 'bbox':
            bounds = region_boundaries['bounds']
            lat = bounds['min_lat']
            while lat <= bounds['max_lat']:
                lng = bounds['min_lng']
                while lng <= bounds['max_lng']:
                    point = (lat, lng)
                    # Check if point is near any order cluster
                    nearby_orders = sum(
                        1 for cluster in order_clusters
                        if haversine_distance(point, (cluster['latitude'], cluster['longitude'])) < 5.0
                    )
                    if nearby_orders > 0:
                        candidates.append(point)
                    lng += grid_resolution
                lat += grid_resolution
        else:
            # Polygon - generate grid within polygon
            polygon_bounds = calculate_polygon_bounds(region_boundaries['coordinates'])
            lat = polygon_bounds['min_lat']
            while lat <= polygon_bounds['max_lat']:
                lng = polygon_bounds['min_lng']
                while lng <= polygon_bounds['max_lng']:
                    point = (lat, lng)
                    if point_in_polygon(point, region_boundaries['coordinates']):
                        nearby_orders = sum(
                            1 for cluster in order_clusters
                            if haversine_distance(point, (cluster['latitude'], cluster['longitude'])) < 5.0
                        )
                        if nearby_orders > 0:
                            candidates.append(point)
                    lng += grid_resolution
                lat += grid_resolution
        
        # Remove duplicates (within small tolerance)
        unique_candidates = []
        for candidate in candidates:
            is_duplicate = False
            for existing in unique_candidates:
                if haversine_distance(candidate, existing) < 0.1:  # ~100m tolerance
                    is_duplicate = True
                    break
            if not is_duplicate:
                unique_candidates.append(candidate)
        
        logger.info(f"Generated {len(candidates)} total candidates "
                    f"({len(unique_candidates)} unique after deduplication)")
        
        return unique_candidates
    
    def select_top_locations(
        self,
        scored_locations: List[Dict],
        top_n: int = 3,
        min_distance_between: float = 5.0  # km
    ) -> List[Dict]:
        """
        Select top N locations ensuring geographic diversity.
        
        Args:
            scored_locations: List of scored location dictionaries (from score_fulfillment_location)
            top_n: Number of top locations to select (default: 3)
            min_distance_between: Minimum distance between selected locations in km (default: 5.0)
            
        Returns:
            List of top locations with scores and metrics, sorted by score (highest first)
        """
        if not scored_locations:
            logger.debug("No scored locations provided to select_top_locations")
            return []
        
        # Sort by score (highest first)
        sorted_locations = sorted(scored_locations, key=lambda x: x['score'], reverse=True)
        
        selected = []
        filtered_out = 0
        
        for location_data in sorted_locations:
            if len(selected) >= top_n:
                break
            
            location = location_data['location']
            
            # Check if this location is far enough from already selected locations
            is_diverse = True
            for selected_data in selected:
                selected_location = selected_data['location']
                distance = haversine_distance(location, selected_location)
                if distance < min_distance_between:
                    is_diverse = False
                    filtered_out += 1
                    break
            
            if is_diverse:
                selected.append(location_data)
        
        if filtered_out > 0:
            logger.debug(f"Diversity filter filtered out {filtered_out} locations "
                       f"(min_distance={min_distance_between}km)")
        
        return selected
    
    def find_top_fulfillment_locations(
        self,
        region_boundaries: RegionBoundaries,
        order_volumes_result: OrderVolumeResult,
        top_n: int = 3,
        grid_resolution: float = 0.01,
        min_distance_between: float = 5.0,
        min_orders_per_route: int = 5,
        max_orders_per_route: int = 15,
        max_service_radius_km: float = 50.0,
        distance_weight: float = 0.4,
        volume_weight: float = 0.4,
        efficiency_weight: float = 0.2
    ) -> List[Dict]:
        """
        Find top N fulfillment locations within a region.
        
        This is the main entry point for the complete fulfillment location optimization.
        
        Args:
            region_boundaries: Region boundaries
            order_volumes_result: Result from calculate_order_volume_by_region()
            top_n: Number of top locations to return (default: 3)
            grid_resolution: Grid resolution for candidate generation (default: 0.01 ≈ 1km)
            min_distance_between: Minimum distance between selected locations in km (default: 5.0)
            min_orders_per_route: Minimum orders per route (default: 5)
            max_orders_per_route: Maximum orders per route (default: 15)
            max_service_radius_km: Maximum service radius (default: 50km)
            distance_weight: Weight for distance factor (default: 0.4)
            volume_weight: Weight for volume factor (default: 0.4)
            efficiency_weight: Weight for efficiency factor (default: 0.2)
            
        Returns:
            List of top N locations with scores and metrics
        """
        # Log initial parameters
        logger.info(f"Finding top {top_n} locations for region: {region_boundaries}")
        region_summary = order_volumes_result['region_summary']
        logger.info(f"Order volumes: {len(order_volumes_result['coordinate_clusters'])} clusters, "
                    f"{region_summary['total_orders']} total orders, "
                    f"{region_summary['unique_customers']} unique customers")
        
        # Step 1: Generate candidate locations
        candidates = self.generate_candidate_locations(
            region_boundaries,
            order_volumes_result,
            grid_resolution
        )
        
        logger.info(f"Generated {len(candidates)} candidate locations")
        
        if not candidates:
            logger.warning("No candidate locations generated. Check region boundaries and order volumes.")
            return []
        
        # Step 2: Score all candidates
        scored_locations = []
        scored_count = 0
        failed_count = 0
        for candidate in candidates:
            try:
                score_result = self.score_fulfillment_location(
                    candidate,
                    order_volumes_result,
                    region_boundaries,
                    min_orders_per_route,
                    max_orders_per_route,
                    max_service_radius_km,
                    distance_weight,
                    volume_weight,
                    efficiency_weight
                )
                scored_locations.append(score_result)
                scored_count += 1
            except Exception as e:
                logger.warning(f"Error scoring candidate {candidate}: {e}", exc_info=True)
                failed_count += 1
                continue
        
        logger.info(f"Successfully scored {scored_count}/{len(candidates)} candidates "
                    f"({failed_count} failed)")
        
        if not scored_locations:
            logger.warning("No candidates were successfully scored. Cannot select locations.")
            return []
        
        # Step 3: Select top N with diversity
        top_locations = self.select_top_locations(
            scored_locations,
            top_n,
            min_distance_between
        )
        
        logger.info(f"Selected {len(top_locations)} locations (requested {top_n})")
        
        # Step 4: Fallback logic if fewer than top_n locations found
        if len(top_locations) < top_n and len(scored_locations) > len(top_locations):
            logger.info(f"Fallback: Only {len(top_locations)} locations found with "
                       f"min_distance={min_distance_between}km. Trying relaxed filter...")
            
            # Try with relaxed distance (half of original)
            relaxed_distance = min_distance_between / 2.0
            relaxed_locations = self.select_top_locations(
                scored_locations,
                top_n,
                relaxed_distance
            )
            
            if len(relaxed_locations) > len(top_locations):
                logger.info(f"Fallback successful: Found {len(relaxed_locations)} locations "
                           f"with relaxed distance {relaxed_distance}km")
                top_locations = relaxed_locations
            else:
                # Return best available (even if < top_n)
                logger.warning(f"Fallback: Returning {len(top_locations)} best locations "
                             f"(requested {top_n}). Insufficient geographic diversity.")
        elif len(top_locations) < top_n:
            logger.warning(f"Only {len(top_locations)} locations selected (requested {top_n}). "
                          f"Diversity filter may be too strict (min_distance={min_distance_between}km)")
        
        return top_locations
    
    def _aggregate_results(self, filtered_aggregates: List[Dict]) -> OrderVolumeResult:
        """
        Aggregate results from filtered coordinate aggregates.
        
        Args:
            filtered_aggregates: List of aggregate dictionaries
            
        Returns:
            OrderVolumeResult with summary and clusters
        """
        # Handle empty region
        if not filtered_aggregates:
            return {
                'region_summary': {
                    'total_orders': 0,
                    'unique_customers': 0,
                    'total_revenue': 0.0,
                    'avg_order_value': 0.0,
                    'coordinate_points': 0,
                    'region_area_km2': None
                },
                'coordinate_clusters': []
            }
        
        # Aggregate metrics
        total_orders = sum(agg['total_orders'] for agg in filtered_aggregates)
        total_revenue = sum(agg['total_revenue'] for agg in filtered_aggregates)
        
        # Unique customers: Sum from aggregates (approximation)
        # Note: This is an approximation since customers may appear in multiple aggregates
        unique_customers = sum(agg['unique_customers'] for agg in filtered_aggregates)
        
        # Calculate weighted average order value
        avg_order_value = total_revenue / total_orders if total_orders > 0 else 0.0
        
        # Build coordinate clusters list
        coordinate_clusters: List[CoordinateCluster] = []
        for agg in filtered_aggregates:
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
        
        return {
            'region_summary': {
                'total_orders': total_orders,
                'unique_customers': unique_customers,
                'total_revenue': total_revenue,
                'avg_order_value': avg_order_value,
                'coordinate_points': len(filtered_aggregates),
                'region_area_km2': None  # To be implemented in Phase 2
            },
            'coordinate_clusters': coordinate_clusters
        }


# ============================================================================
# Helper Functions for Scoring
# ============================================================================

def haversine_distance(point1: Tuple[float, float], point2: Tuple[float, float]) -> float:
    """
    Calculate distance between two points using Haversine formula.
    
    Args:
        point1: Tuple of (latitude, longitude)
        point2: Tuple of (latitude, longitude)
        
    Returns:
        Distance in kilometers
    """
    R = 6371  # Earth radius in km
    
    lat1, lng1 = math.radians(point1[0]), math.radians(point1[1])
    lat2, lng2 = math.radians(point2[0]), math.radians(point2[1])
    
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    
    distance = R * c
    return distance


@lru_cache(maxsize=10000)
def cached_haversine_distance(
    lat1: float, lng1: float,
    lat2: float, lng2: float
) -> float:
    """
    Cached version of Haversine distance calculation.
    
    Args:
        lat1, lng1: First point coordinates
        lat2, lng2: Second point coordinates
        
    Returns:
        Distance in kilometers
    """
    return haversine_distance((lat1, lng1), (lat2, lng2))


def get_orders_within_radius(
    location: Tuple[float, float],
    order_clusters: List[CoordinateCluster],
    radius_km: float
) -> List[CoordinateCluster]:
    """
    Filter order clusters to only those within radius of location.
    
    Uses vectorized batch distance calculation for performance optimization.
    
    Args:
        location: Tuple of (latitude, longitude)
        order_clusters: List of coordinate cluster dictionaries
        radius_km: Radius in kilometers
        
    Returns:
        Filtered list of coordinate clusters within radius
    """
    if not order_clusters:
        return []
    
    # Use vectorized batch calculation for better performance
    if len(order_clusters) > 10:  # Use vectorization for larger datasets
        return _get_orders_within_radius_vectorized(location, order_clusters, radius_km)
    else:
        # For small datasets, use simple loop (lower overhead)
        filtered = []
        for cluster in order_clusters:
            cluster_location = (cluster['latitude'], cluster['longitude'])
            distance = cached_haversine_distance(
                location[0], location[1],
                cluster_location[0], cluster_location[1]
            )
            if distance <= radius_km:
                filtered.append(cluster)
        return filtered


def _get_orders_within_radius_vectorized(
    location: Tuple[float, float],
    order_clusters: List[CoordinateCluster],
    radius_km: float
) -> List[CoordinateCluster]:
    """
    Vectorized version of get_orders_within_radius using NumPy.
    
    This is significantly faster for large datasets (>10 clusters).
    """
    if not order_clusters:
        return []
    
    # Convert to NumPy arrays
    location_array = np.array([location[0], location[1]])
    cluster_coords = np.array([
        [cluster['latitude'], cluster['longitude']] 
        for cluster in order_clusters
    ])
    
    # Calculate distances using vectorized Haversine
    distances = batch_haversine_distance(location_array, cluster_coords)
    
    # Filter clusters within radius
    within_radius_mask = distances <= radius_km
    filtered = [
        cluster for i, cluster in enumerate(order_clusters)
        if within_radius_mask[i]
    ]
    
    return filtered


def batch_haversine_distance(
    point1: np.ndarray,
    points: np.ndarray
) -> np.ndarray:
    """
    Calculate distances from one point to multiple points using vectorized Haversine formula.
    
    Args:
        point1: Array of shape (2,) with (lat, lng)
        points: Array of shape (n, 2) with (lat, lng) pairs
        
    Returns:
        Array of shape (n,) with distances in kilometers
    """
    R = 6371.0  # Earth radius in km
    
    # Convert to radians
    lat1_rad = np.radians(point1[0])
    lng1_rad = np.radians(point1[1])
    lats_rad = np.radians(points[:, 0])
    lngs_rad = np.radians(points[:, 1])
    
    # Calculate differences
    dlat = lats_rad - lat1_rad
    dlng = lngs_rad - lng1_rad
    
    # Haversine formula (vectorized)
    a = (np.sin(dlat/2)**2 + 
         np.cos(lat1_rad) * np.cos(lats_rad) * np.sin(dlng/2)**2)
    c = 2 * np.arcsin(np.sqrt(a))
    distances = R * c
    
    return distances


# ============================================================================
# Fulfillment Location Scoring
# ============================================================================

class LocationScoreCache:
    """
    LRU cache for location scores with TTL support.
    """
    
    def __init__(self, max_size: int = 500, ttl_seconds: int = 1800):
        """
        Initialize the cache.
        
        Args:
            max_size: Maximum number of cached entries (LRU eviction)
            ttl_seconds: Time-to-live in seconds (default: 30 minutes)
        """
        self.max_size = max_size
        self.ttl_seconds = ttl_seconds
        self._cache: OrderedDict[str, Tuple[float, Dict]] = OrderedDict()
    
    def _create_key(self, location: Tuple[float, float], order_volumes_hash: str) -> str:
        """Create a hash key from location and order volumes"""
        # Round coordinates to 6 decimal places (~10cm precision) for cache key
        lat_rounded = round(location[0], 6)
        lng_rounded = round(location[1], 6)
        cache_str = f"{lat_rounded},{lng_rounded}:{order_volumes_hash}"
        return hashlib.sha256(cache_str.encode()).hexdigest()
    
    def get(self, location: Tuple[float, float], order_volumes_hash: str) -> Optional[Dict]:
        """Get cached result if available and not expired"""
        key = self._create_key(location, order_volumes_hash)
        
        if key not in self._cache:
            return None
        
        # Check TTL
        timestamp, result = self._cache[key]
        if time.time() - timestamp > self.ttl_seconds:
            del self._cache[key]
            return None
        
        # Move to end (most recently used)
        self._cache.move_to_end(key)
        return result
    
    def set(self, location: Tuple[float, float], order_volumes_hash: str, result: Dict):
        """Cache a result"""
        key = self._create_key(location, order_volumes_hash)
        
        if key in self._cache:
            del self._cache[key]
        
        self._cache[key] = (time.time(), result)
        
        # Evict oldest if over limit
        if len(self._cache) > self.max_size:
            self._cache.popitem(last=False)
    
    def clear(self):
        """Clear all cached entries"""
        self._cache.clear()
    
    def get_stats(self) -> Dict[str, int]:
        """Get cache statistics"""
        return {
            'size': len(self._cache),
            'max_size': self.max_size,
            'ttl_seconds': self.ttl_seconds
        }


