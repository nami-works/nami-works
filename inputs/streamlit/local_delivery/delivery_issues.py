"""
Local Delivery - Delivery Issues View
Sub-function for managing orders with delivery issues (ld_devolucao, ld_reentrega)
"""

import streamlit as st
import pandas as pd
from typing import Dict, List, Optional
from datetime import datetime, timedelta, date
import asyncio
from ._local_delivery import DeliveryAddressMapper
from functions.shared.ui_helpers import render_section_header, render_subsection_header
from functions.shared.button_styles import apply_primary_button_styles
from apis.shopify.shopify_connector import ShopifyGraphQLClient


def handle_delivery_issues_view():
    """Main handler for Delivery Issues View sub-function"""
    # Get context info (same as main Local Delivery)
    from .context import LOCAL_DELIVERY_CONTEXT
    context_info = st.session_state.get('context_info', LOCAL_DELIVERY_CONTEXT)
    
    # Initialize mapper
    mapper = DeliveryAddressMapper()
    
    # Render the delivery issues view interface
    render_delivery_issues_view(mapper)


def render_delivery_issues_view(mapper: DeliveryAddressMapper):
    """
    Render the Delivery Issues View interface.
    
    Similar structure to render_delivery_map() but WITHOUT map:
    - Section header
    - Description
    - Filters (fulfillment location, date range)
    - Statistics (return orders count, re-delivery orders count)
    - Orders table/list
    - Tag removal functionality
    """
    # Apply shared button styles
    apply_primary_button_styles()
    
    # Section header
    render_section_header("🏷️ Delivery Issues Orders")
    
    st.markdown("""
    View and manage orders with delivery issues (returns and re-deliveries). 
    Remove tags after processing to keep your order list clean.
    """)
    
    # Check if orders are loaded
    if 'delivery_orders_data' not in st.session_state or not st.session_state.delivery_orders_data:
        st.info("👆 Please load orders first using the 'Main View' interface.")
        return
    
    # Get all orders
    all_orders = st.session_state.delivery_orders_data
    
    # Filter orders with delivery issues
    delivery_issue_orders = []
    for order in all_orders:
        tags = order.get('tags', [])
        if isinstance(tags, str):
            tags = [tag.strip() for tag in tags.split(',') if tag.strip()]
        elif not isinstance(tags, list):
            tags = []
        
        has_devolucao = 'ld_devolucao' in tags
        has_reentrega = 'ld_reentrega' in tags
        
        if has_devolucao or has_reentrega:
            delivery_issue_orders.append(order)
    
    if not delivery_issue_orders:
        st.info("✅ No orders with delivery issues found in the current dataset.")
        return
    
    # Filters section
    with st.expander("🔍 Filters", expanded=False):
        # Fulfillment location filter
        mapped_locations = list(set(mapper.PROVINCE_TO_LOCATION_MAP.values()))
        location_options = ["All fulfillment locations"] + sorted(mapped_locations)
        
        fulfillment_location_filter = st.selectbox(
            "Fulfillment location",
            options=location_options,
            key="delivery_issues_fulfillment_location_filter",
            help="Filter by fulfillment location"
        )
        
        # Date filters
        today = date.today()
        last_7_days_start = date.today() - timedelta(days=7)
        
        # Initialize date filters if not exists
        if 'delivery_issues_start_date' not in st.session_state:
            st.session_state.delivery_issues_start_date = last_7_days_start
        if 'delivery_issues_end_date' not in st.session_state:
            st.session_state.delivery_issues_end_date = today
        
        date_col1, date_col2 = st.columns(2)
        with date_col1:
            start_date = st.date_input(
                "Start date",
                value=st.session_state.delivery_issues_start_date,
                key="delivery_issues_start_date_input"
            )
            st.session_state.delivery_issues_start_date = start_date
        
        with date_col2:
            end_date = st.date_input(
                "End date",
                value=st.session_state.delivery_issues_end_date,
                key="delivery_issues_end_date_input"
            )
            st.session_state.delivery_issues_end_date = end_date
    
    # Apply filters
    filtered_orders = delivery_issue_orders.copy()
    
    # Filter by fulfillment location
    if fulfillment_location_filter != "All fulfillment locations":
        filtered_orders = [
            o for o in filtered_orders 
            if o.get('fulfillment_location') == fulfillment_location_filter
        ]
    
    # Filter by date range
    filtered_orders = [
        o for o in filtered_orders
        if _is_order_in_date_range(o, start_date, end_date)
    ]
    
    # Statistics Display
    st.divider()
    render_subsection_header("📊 Statistics")
    
    return_orders = [o for o in filtered_orders if _has_tag(o, 'ld_devolucao')]
    redelivery_orders = [o for o in filtered_orders if _has_tag(o, 'ld_reentrega')]
    both_tags_orders = [o for o in filtered_orders if _has_tag(o, 'ld_devolucao') and _has_tag(o, 'ld_reentrega')]
    
    col1, col2, col3 = st.columns(3)
    with col1:
        st.metric("↩️ Return Orders", len(return_orders))
    with col2:
        st.metric("🔄 Re-delivery Orders", len(redelivery_orders))
    with col3:
        st.metric("Both Tags", len(both_tags_orders))
    
    st.divider()
    
    # Orders Table
    render_subsection_header("📋 Orders with Delivery Issues")
    
    if not filtered_orders:
        st.info("No orders match the selected filters.")
        return
    
    # Prepare data for display
    display_data = []
    for order in filtered_orders:
        tags = order.get('tags', [])
        if isinstance(tags, str):
            tags = [tag.strip() for tag in tags.split(',') if tag.strip()]
        elif not isinstance(tags, list):
            tags = []
        
        # Format tags display
        tag_display = []
        if 'ld_devolucao' in tags:
            tag_display.append("↩️ ld_devolucao")
        if 'ld_reentrega' in tags:
            tag_display.append("🔄 ld_reentrega")
        
        # Format date
        created_at = order.get('created_at', '')
        if created_at:
            try:
                dt = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                formatted_date = dt.strftime('%Y-%m-%d %H:%M')
            except:
                formatted_date = created_at
        else:
            formatted_date = 'N/A'
        
        # Format address
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
            'Tags': ', '.join(tag_display),
            'Address': formatted_address,
            'Status': order.get('fulfillment_status', 'N/A'),
            'order_id': order.get('order_id', ''),
            'tags': tags
        })
    
    # Convert to DataFrame
    df = pd.DataFrame(display_data)
    
    if len(df) > 0:
        # Display table
        display_cols = ['Order Number', 'Date', 'Customer', 'Tags', 'Address', 'Status']
        st.dataframe(
            df[display_cols],
            use_container_width=True,
            height=400,
            key="delivery_issues_orders_table"
        )
    
    st.divider()
    
    # Tag Removal Section
    render_subsection_header("🗑️ Remove Delivery Issue Tags")
    
    st.markdown("Select orders and tags to remove from Shopify.")
    
    # Get orders with delivery issues for removal selection
    orders_with_delivery_issues = []
    for order in filtered_orders:
        tags = order.get('tags', [])
        if isinstance(tags, str):
            tags = [tag.strip() for tag in tags.split(',') if tag.strip()]
        elif not isinstance(tags, list):
            tags = []
        
        has_devolucao = 'ld_devolucao' in tags
        has_reentrega = 'ld_reentrega' in tags
        
        if has_devolucao or has_reentrega:
            tag_display = []
            if has_devolucao:
                tag_display.append("↩️")
            if has_reentrega:
                tag_display.append("🔄")
            
            orders_with_delivery_issues.append({
                'order_id': order.get('order_id', ''),
                'order_name': order.get('order_name', 'Unknown'),
                'has_devolucao': has_devolucao,
                'has_reentrega': has_reentrega,
                'emoji': ' '.join(tag_display)
            })
    
    if orders_with_delivery_issues:
        # Multiselect for orders
        order_options = [f"{o['order_name']} {o['emoji']}" for o in orders_with_delivery_issues]
        selected_order_display = st.multiselect(
            "Select orders to remove tags from:",
            options=order_options,
            key="delivery_issues_remove_orders_select"
        )
        
        # Tag selection
        tag_options = []
        if any(o['has_devolucao'] for o in orders_with_delivery_issues):
            tag_options.append('ld_devolucao')
        if any(o['has_reentrega'] for o in orders_with_delivery_issues):
            tag_options.append('ld_reentrega')
        
        selected_tags_to_remove = st.multiselect(
            "Select tags to remove:",
            options=tag_options,
            key="delivery_issues_remove_tags_select"
        )
        
        # Remove tags button
        if selected_order_display and selected_tags_to_remove:
            if st.button("🗑️ Remove Tags", type="primary", use_container_width=True, key="delivery_issues_remove_button"):
                # Map display names back to order IDs
                order_id_map = {f"{o['order_name']} {o['emoji']}": o['order_id'] 
                              for o in orders_with_delivery_issues}
                
                order_ids_to_update = [order_id_map[display] for display in selected_order_display if display in order_id_map]
                
                if order_ids_to_update:
                    with st.spinner(f"Removing tags from {len(order_ids_to_update)} order(s)..."):
                        try:
                            loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(loop)
                            try:
                                async def remove_tags_batch():
                                    async with ShopifyGraphQLClient() as client:
                                        success_count = 0
                                        error_count = 0
                                        for order_id in order_ids_to_update:
                                            try:
                                                result = await mapper._remove_order_tags(client, order_id, selected_tags_to_remove)
                                                if result:
                                                    success_count += 1
                                                    # Update local order data
                                                    for order in st.session_state.delivery_orders_data:
                                                        if order['order_id'] == order_id:
                                                            tags = order.get('tags', [])
                                                            if isinstance(tags, str):
                                                                tags = [tag.strip() for tag in tags.split(',') if tag.strip()]
                                                            elif not isinstance(tags, list):
                                                                tags = []
                                                            # Remove the tags
                                                            tags = [tag for tag in tags if tag not in selected_tags_to_remove]
                                                            order['tags'] = tags
                                                            order['has_devolucao'] = 'ld_devolucao' in tags
                                                            order['has_reentrega'] = 'ld_reentrega' in tags
                                                            order['has_return'] = 'ld_devolucao' in tags
                                                else:
                                                    error_count += 1
                                            except Exception as e:
                                                error_count += 1
                                                st.debug(f"Error removing tags from order {order_id}: {str(e)}")
                                        return success_count, error_count
                                
                                success_count, error_count = loop.run_until_complete(remove_tags_batch())
                                
                                if success_count > 0:
                                    st.success(f"✅ Removed tags from {success_count} order(s)")
                                if error_count > 0:
                                    st.warning(f"⚠️ Failed to remove tags from {error_count} order(s)")
                                
                                # Refresh the display
                                st.rerun()
                            finally:
                                loop.close()
                        except Exception as e:
                            st.error(f"Error removing tags: {str(e)}")
    else:
        st.info("No orders with delivery issues found in filtered results.")


def _has_tag(order: Dict, tag: str) -> bool:
    """Check if order has delivery issue tag (handles both string and list formats)"""
    tags = order.get('tags', [])
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(',') if t.strip()]
    elif not isinstance(tags, list):
        tags = []
    return tag in tags


def _is_order_in_date_range(order: Dict, start_date: date, end_date: date) -> bool:
    """Check if order creation date is within the specified range"""
    created_at = order.get('created_at', '')
    if not created_at:
        return False
    
    try:
        dt = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
        order_date = dt.date()
        return start_date <= order_date <= end_date
    except:
        return False

