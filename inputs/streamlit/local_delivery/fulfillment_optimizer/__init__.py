"""
Fulfillment Optimizer Module for Local Delivery

Provides functionality to define optimal places for local deliveries.
"""

from .fulfillment_optimizer_ui import render_fulfillment_optimizer_view

__all__ = [
    'handle_fulfillment_optimizer_view',
    'render_fulfillment_optimizer_view',
]


def handle_fulfillment_optimizer_view():
    """Main handler for Fulfillment Optimizer sub-function"""
    import streamlit as st
    from ..context import LOCAL_DELIVERY_CONTEXT
    
    # Get context info (same as main Local Delivery)
    context_info = st.session_state.get('context_info', LOCAL_DELIVERY_CONTEXT)
    
    # Render the fulfillment optimizer view interface
    render_fulfillment_optimizer_view()


