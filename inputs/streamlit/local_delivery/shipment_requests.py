"""
Shipment Requests Module for Local Delivery

Handles automated shipment requests for orders originally sent through fulfillment centers
that need to be resent from different fulfillment locations.
"""

import json
import logging
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime
from pathlib import Path
from apis.shopify.shopify_connector import ShopifyGraphQLClient

# Setup logging
logger = logging.getLogger(__name__)

# GraphQL query to fetch full order data with line items for shipment requests
ORDER_WITH_LINE_ITEMS_QUERY = """
query GetOrderWithLineItems($id: ID!) {
  order(id: $id) {
    id
    name
    email
    customer {
      id
      email
      firstName
      lastName
      phone
      taxExemptions {
        countryCode
        regionCode
        taxId
      }
    }
    shippingAddress {
      address1
      address2
      city
      province
      country
      zip
      firstName
      lastName
      phone
      name
      company
    }
    lineItems(first: 250) {
      edges {
        node {
          id
          title
          quantity
          variant {
            id
            sku
            price
            availableForSale
            product {
              id
              title
              status
            }
          }
          originalUnitPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
        }
      }
    }
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
    tags
    note
    customAttributes {
      key
      value
    }
  }
}
"""


class ShipmentRequestProcessor:
    """Handles shipment request operations"""
    
    def __init__(self, client: ShopifyGraphQLClient):
        """Initialize ShipmentRequestProcessor with Shopify client
        
        Args:
            client: ShopifyGraphQLClient instance
        """
        self.client = client
        self.log_file = Path("data/local_delivery/shipment_requests_log.json")
        self.log_file.parent.mkdir(parents=True, exist_ok=True)
    
    async def fetch_full_order_data(self, order_id: str) -> Optional[Dict]:
        """Fetch full order data including line items from Shopify
        
        Args:
            order_id: Order ID (gid://shopify/Order/...)
            
        Returns:
            Full order data dict or None if not found
        """
        try:
            # Ensure order_id is in correct format (gid://shopify/Order/...)
            if not order_id.startswith('gid://'):
                # Try to convert numeric ID to GID format
                if order_id.isdigit():
                    order_id = f"gid://shopify/Order/{order_id}"
                else:
                    # Try to extract numeric ID from string
                    import re
                    match = re.search(r'(\d+)', order_id)
                    if match:
                        order_id = f"gid://shopify/Order/{match.group(1)}"
                    else:
                        logger.error(f"Invalid order ID format: {order_id}")
                        return None
            
            variables = {'id': order_id}
            result = await self.client.execute_query(ORDER_WITH_LINE_ITEMS_QUERY, variables)
            
            # Check for GraphQL errors first
            if 'errors' in result:
                error_messages = []
                for err in result.get('errors', []):
                    message = err.get('message', 'Unknown error')
                    # Check for permission-related errors
                    if 'permission' in message.lower() or 'scope' in message.lower() or 'access' in message.lower():
                        error_messages.append(f"{message} (Check that your access token has 'read_orders' and 'read_customers' scopes)")
                    elif 'taxExemptions' in message or 'taxExemption' in message:
                        error_messages.append(f"{message} (taxExemptions field requires 'read_customers' scope)")
                    else:
                        error_messages.append(message)
                
                # If error is about taxExemptions, try query without it
                if any('taxExemptions' in msg or 'taxExemption' in msg for msg in error_messages):
                    logger.warning(f"Tax exemptions field not accessible, retrying without it for order {order_id}")
                    return await self._fetch_order_without_tax_exemptions(order_id)
                
                logger.error(f"GraphQL errors fetching order {order_id}: {'; '.join(error_messages)}")
                return None
            
            if 'data' in result and result['data']:
                order = result['data'].get('order')
                if order:
                    return order
            
            logger.warning(f"Order {order_id} not found or has no data")
            return None
            
        except Exception as e:
            logger.error(f"Error fetching order {order_id}: {e}")
            # Try fallback query without taxExemptions
            try:
                return await self._fetch_order_without_tax_exemptions(order_id)
            except Exception as fallback_error:
                logger.error(f"Fallback query also failed for order {order_id}: {fallback_error}")
                return None
    
    async def _fetch_order_without_tax_exemptions(self, order_id: str) -> Optional[Dict]:
        """Fetch order data without taxExemptions field (fallback when permissions are limited)
        
        Args:
            order_id: Order ID (gid://shopify/Order/...)
            
        Returns:
            Full order data dict or None if not found
        """
        # Query without taxExemptions field
        query_without_tax = """
        query GetOrderWithLineItems($id: ID!) {
          order(id: $id) {
            id
            name
            email
            customer {
              id
              email
              firstName
              lastName
              phone
            }
            shippingAddress {
              address1
              address2
              city
              province
              country
              zip
              firstName
              lastName
              phone
              name
              company
            }
            lineItems(first: 250) {
              edges {
                node {
                  id
                  title
                  quantity
                  variant {
                    id
                    sku
                    price
                    availableForSale
                    product {
                      id
                      title
                      status
                    }
                  }
                  originalUnitPriceSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
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
            tags
            note
            customAttributes {
              key
              value
            }
          }
        }
        """
        
        try:
            variables = {'id': order_id}
            result = await self.client.execute_query(query_without_tax, variables)
            
            if 'errors' in result:
                error_messages = [err.get('message', 'Unknown error') for err in result.get('errors', [])]
                logger.error(f"GraphQL errors in fallback query for order {order_id}: {'; '.join(error_messages)}")
                return None
            
            if 'data' in result and result['data']:
                order = result['data'].get('order')
                if order:
                    return order
            
            return None
        except Exception as e:
            logger.error(f"Error in fallback query for order {order_id}: {e}")
            return None
    
    def extract_order_data(self, order: Dict) -> Dict:
        """Extract all order data needed for shipment requests
        
        Args:
            order: Full order data from Shopify (from fetch_full_order_data)
            
        Returns:
            Dict with extracted order data for shipment requests
        """
        # Extract line items
        line_items = []
        line_items_edges = order.get('lineItems', {}).get('edges', [])
        
        for edge in line_items_edges:
            node = edge.get('node', {})
            variant = node.get('variant')
            
            if not variant:
                logger.warning(f"Line item {node.get('id')} has no variant, skipping")
                continue
            
            variant_id = variant.get('id')
            if not variant_id:
                logger.warning(f"Line item {node.get('id')} variant has no ID, skipping")
                continue
            
            # Get price from original order or variant
            price_data = node.get('originalUnitPriceSet', {}).get('shopMoney', {})
            price = price_data.get('amount') if price_data else variant.get('price', '0')
            
            line_items.append({
                'variant_id': variant_id,
                'quantity': node.get('quantity', 1),
                'price': str(price),
                'title': node.get('title', ''),
                'sku': variant.get('sku', ''),
                'available': variant.get('availableForSale', True),
                'product_status': variant.get('product', {}).get('status', 'ACTIVE')
            })
        
        # Extract customer information
        customer = order.get('customer', {})
        customer_id = customer.get('id')
        email = order.get('email') or customer.get('email')
        customer_first_name = customer.get('firstName', '')
        customer_last_name = customer.get('lastName', '')
        customer_phone = customer.get('phone', '')
        
        # Extract tax exemptions (CPF/CNPJ)
        tax_exemptions = customer.get('taxExemptions', [])
        tax_id = None
        if tax_exemptions:
            # Get the first tax exemption (usually contains CPF/CNPJ for Brazil)
            tax_exemption = tax_exemptions[0]
            tax_id = tax_exemption.get('taxId')
        
        # Fallback: Check custom attributes for CPF/CNPJ if not found in tax exemptions
        if not tax_id:
            custom_attributes = order.get('customAttributes', [])
            for attr in custom_attributes:
                key = attr.get('key', '').lower()
                value = attr.get('value', '')
                # Common keys for CPF/CNPJ in Brazilian stores
                if key in ['cpf', 'cnpj', 'tax_id', 'taxid', 'document', 'documento'] and value:
                    tax_id = value
                    break
        
        # Extract shipping address
        shipping_address = order.get('shippingAddress', {})
        shipping = {
            'address1': shipping_address.get('address1', ''),
            'address2': shipping_address.get('address2', ''),
            'city': shipping_address.get('city', ''),
            'province': shipping_address.get('province', ''),
            'country': shipping_address.get('country', ''),
            'zip': shipping_address.get('zip', ''),
            'firstName': shipping_address.get('firstName', '') or customer_first_name,
            'lastName': shipping_address.get('lastName', '') or customer_last_name,
            'phone': shipping_address.get('phone', '') or customer_phone,
            'company': shipping_address.get('company', ''),
        }
        
        # Always use shipping address for billing address
        billing = shipping.copy()
        
        # Extract shipping line
        shipping_line = order.get('shippingLine', {})
        shipping_price_data = shipping_line.get('originalPriceSet', {}).get('shopMoney', {})
        shipping_price = shipping_price_data.get('amount', '0') if shipping_price_data else '0'
        
        # Extract tags and notes
        tags = order.get('tags', [])
        if isinstance(tags, str):
            tags = [tag.strip() for tag in tags.split(',') if tag.strip()]
        
        note = order.get('note', '')
        
        # Extract custom attributes
        custom_attributes = order.get('customAttributes', [])
        
        return {
            'order_id': order.get('id'),
            'order_name': order.get('name'),
            'line_items': line_items,
            'customer_id': customer_id,
            'email': email,
            'customer_first_name': customer_first_name,
            'customer_last_name': customer_last_name,
            'customer_phone': customer_phone,
            'tax_id': tax_id,
            'shipping_address': shipping,
            'billing_address': billing,
            'shipping_price': shipping_price,
            'shipping_currency': shipping_price_data.get('currencyCode', 'BRL') if shipping_price_data else 'BRL',
            'tags': tags,
            'note': note,
            'custom_attributes': custom_attributes
        }
    
    def determine_shipment_request_location(self, order: Dict, province_to_location_map: Dict[str, str]) -> Optional[str]:
        """Determine correct fulfillment location for shipment request
        
        Args:
            order: Processed order data from Local Delivery
            province_to_location_map: Mapping of provinces to fulfillment locations
            
        Returns:
            Fulfillment location name or None
        """
        province = order.get('province', '')
        if not province:
            return None
        
        # Try full province name first
        location = province_to_location_map.get(province)
        if location:
            return location
        
        # Try province code
        location = province_to_location_map.get(province.upper())
        if location:
            return location
        
        return None
    
    def validate_shipment_request_eligibility(self, order_data: Dict) -> Tuple[bool, List[str]]:
        """Check if order is eligible for shipment request
        
        Args:
            order_data: Extracted order data from extract_order_data
            
        Returns:
            Tuple of (is_eligible, list_of_issues)
        """
        issues = []
        
        # Check for line items
        if not order_data.get('line_items'):
            issues.append("No line items found")
        
        # Check for shipping address
        shipping = order_data.get('shipping_address', {})
        if not shipping.get('address1'):
            issues.append("Missing shipping address")
        
        # Check for customer or email
        if not order_data.get('customer_id') and not order_data.get('email'):
            issues.append("Missing customer ID and email")
        
        # Check for available variants
        unavailable_items = []
        for item in order_data.get('line_items', []):
            if not item.get('available', True):
                unavailable_items.append(item.get('title', 'Unknown'))
            if item.get('product_status') != 'ACTIVE':
                unavailable_items.append(f"{item.get('title', 'Unknown')} (product inactive)")
        
        if unavailable_items:
            issues.append(f"Unavailable items: {', '.join(unavailable_items)}")
        
        is_eligible = len(issues) == 0
        return is_eligible, issues
    
    def transform_order_data(self, original_order_data: Dict, target_location: str, original_order_name: str) -> Dict:
        """Transform order data for new order creation
        
        Args:
            original_order_data: Extracted order data from extract_order_data
            target_location: Target fulfillment location name
            original_order_name: Original order name (e.g., "#1001")
            
        Returns:
            Transformed order data ready for draft order creation
        """
        # Build line items for draft order
        line_items = []
        for item in original_order_data.get('line_items', []):
            # Only include available items
            if item.get('available', True) and item.get('product_status') == 'ACTIVE':
                line_items.append({
                    'variant_id': item['variant_id'],
                    'quantity': item['quantity'],
                    'price': item['price']
                })
        
        # Build tags - add shipment request tag
        tags = original_order_data.get('tags', []).copy()
        tags.append(f"reshipped_from:{original_order_name}")
        
        # Build note
        original_note = original_order_data.get('note', '')
        shipment_note = f"Shipment request from order {original_order_name}"
        if original_note:
            note = f"{shipment_note}\n\nOriginal note: {original_note}"
        else:
            note = shipment_note
        
        # Build custom attributes - add original order ID
        custom_attributes = original_order_data.get('custom_attributes', []).copy()
        custom_attributes.append({
            'key': 'original_order_id',
            'value': original_order_data.get('order_id', '')
        })
        
        return {
            'line_items': line_items,
            'customer_id': original_order_data.get('customer_id'),
            'email': original_order_data.get('email'),
            'customer_first_name': original_order_data.get('customer_first_name'),
            'customer_last_name': original_order_data.get('customer_last_name'),
            'customer_phone': original_order_data.get('customer_phone'),
            'tax_id': original_order_data.get('tax_id'),
            'shipping_address': original_order_data.get('shipping_address'),
            'billing_address': original_order_data.get('billing_address'),
            'note': note,
            'tags': tags,
            'custom_attributes': custom_attributes
        }
    
    async def create_shipment_request_order(self, order_data: Dict) -> Dict:
        """Create new order via Shopify API
        
        Args:
            order_data: Transformed order data from transform_order_data
            
        Returns:
            Dict with created order information
        """
        try:
            # Create draft order
            draft_result = await self.client.create_draft_order(order_data)
            
            draft_order = draft_result.get('draftOrder', {})
            draft_order_id = draft_order.get('id')
            
            if not draft_order_id:
                raise Exception("Draft order creation failed - no ID returned")
            
            # Complete the draft order to create actual order
            complete_result = await self.client.complete_draft_order(draft_order_id)
            
            completed_order = complete_result.get('draftOrder', {}).get('order', {})
            
            if not completed_order:
                raise Exception("Draft order completion failed - no order returned")
            
            return {
                'success': True,
                'draft_order_id': draft_order_id,
                'draft_order_name': draft_order.get('name'),
                'order_id': completed_order.get('id'),
                'order_name': completed_order.get('name')
            }
            
        except Exception as e:
            logger.error(f"Error creating shipment request order: {e}")
            return {
                'success': False,
                'error': str(e)
            }
    
    async def link_orders(self, original_order_id: str, new_order_id: str, original_order_name: str, new_order_name: str) -> bool:
        """Link orders via tags and metafields
        
        Args:
            original_order_id: Original order ID
            new_order_id: New order ID
            original_order_name: Original order name
            new_order_name: New order name
            
        Returns:
            True if linking successful, False otherwise
        """
        try:
            # Tags are already added during order creation
            # We can add a metafield to the original order to track shipment requests
            # For now, tags on the new order are sufficient
            logger.info(f"Orders linked: {original_order_name} -> {new_order_name}")
            return True
            
        except Exception as e:
            logger.error(f"Error linking orders: {e}")
            return False
    
    def handle_out_of_stock_items(self, order_data: Dict) -> Dict:
        """Handle out of stock items in order data
        
        Args:
            order_data: Extracted order data
            
        Returns:
            Modified order data with unavailable items flagged
        """
        unavailable_items = []
        available_items = []
        
        for item in order_data.get('line_items', []):
            if item.get('available', True) and item.get('product_status') == 'ACTIVE':
                available_items.append(item)
            else:
                unavailable_items.append(item)
        
        order_data['line_items'] = available_items
        order_data['unavailable_items'] = unavailable_items
        
        return order_data
    
    def handle_price_changes(self, order_data: Dict, current_prices: Dict[str, str]) -> Dict:
        """Handle price changes - update prices to current values
        
        Args:
            order_data: Extracted order data
            current_prices: Dict mapping variant_id to current price
            
        Returns:
            Modified order data with updated prices
        """
        for item in order_data.get('line_items', []):
            variant_id = item.get('variant_id')
            if variant_id in current_prices:
                item['price'] = current_prices[variant_id]
        
        return order_data
    
    def log_shipment_request(self, original_order_id: str, original_order_name: str,
                      new_order_id: Optional[str], new_order_name: Optional[str],
                      fulfillment_location: str, status: str, errors: List[str] = None) -> None:
        """Log shipment request action to audit trail
        
        Args:
            original_order_id: Original order ID
            original_order_name: Original order name
            new_order_id: New order ID (if created)
            new_order_name: New order name (if created)
            fulfillment_location: Fulfillment location
            status: Status (success, failure, etc.)
            errors: List of error messages (if any)
        """
        log_entry = {
            'timestamp': datetime.now().isoformat(),
            'original_order_id': original_order_id,
            'original_order_name': original_order_name,
            'new_order_id': new_order_id,
            'new_order_name': new_order_name,
            'fulfillment_location': fulfillment_location,
            'status': status,
            'errors': errors or []
        }
        
        # Load existing log
        logs = []
        if self.log_file.exists():
            try:
                with open(self.log_file, 'r', encoding='utf-8') as f:
                    logs = json.load(f)
            except Exception as e:
                logger.warning(f"Error reading shipment request log: {e}")
                logs = []
        
        # Append new entry
        logs.append(log_entry)
        
        # Save log
        try:
            with open(self.log_file, 'w', encoding='utf-8') as f:
                json.dump(logs, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Error writing shipment request log: {e}")
