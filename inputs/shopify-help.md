# Mark an order as **fulfilled** via API (Admin **GraphQL** + **REST**) — walkthrough

This walkthrough focuses on the **correct model in Shopify**: you “fulfill” an order by **creating a fulfillment** for its **Fulfillment Order(s)** (not by toggling a field on the Order).

---

## **Concepts (what you’re actually updating)**

- **Order**: what the customer purchased.
- **Fulfillment Order**: Shopify’s internal “units of work” that represent *what can be fulfilled*, often split by **location**, **shipping vs pickup**, or **service**.
- **Fulfillment**: the record that gets created when you ship/hand off items; creating this is what makes the order/items appear fulfilled.

In Shopify Flow, the action **“Mark fulfillment order as fulfilled”**:
- operates on a **Fulfillment Order ID**
- and **creates a fulfillment** for that fulfillment order
- via the **`fulfillmentCreateV`** GraphQL mutation.

---

## **GraphQL Admin API path (create fulfillment with `fulfillmentCreateV`)**

### **) Get the Fulfillment Order(s) you need to fulfill**
You need the **Fulfillment Order ID** to fulfill. In GraphQL, this is the **FulfillmentOrder** object.

- Use the **Fulfillment order resource** and/or the **`fulfillmentOrders`** query (with query filters) to retrieve the Fulfillment Orders you plan to fulfill.

### **) Confirm it can be fulfilled**
A fulfillment order can fail fulfillment creation if it’s not in a fulfillable state (for example, it’s **`ON_HOLD`**).

**Practical pre-check** (recommended):
- Verify whether `[FulfillmentOrder.supportedActions.action](http://FulfillmentOrder.supportedActions.action)` includes **`CREATE_FULFILLMENT`** before attempting to create a fulfillment.

### **) Create the fulfillment**
Call **`fulfillmentCreateV`** with the **Fulfillment Order ID**.

- This is the same mutation referenced by Flow’s “Mark fulfillment order as fulfilled” action.

### **) Optional: if a fulfillment service must accept a request first**
If you’re working with a fulfillment service workflow, you might first need to **submit a fulfillment request** for the Fulfillment Order:

- Use the **`fulfillmentOrderSubmitFulfillmentRequest`** mutation to send a request to fulfill products to a fulfillment service (based on a **Fulfillment Order ID**).

---

## **REST Admin API path (same outcome: create a fulfillment)**

Even if you’re using REST, the mental model stays the same:

. Identify the order’s **Fulfillment Order(s)** (the fulfillable “work units”).
. **Create a fulfillment** for the appropriate fulfillment order/items.

> REST isn’t “mark order as fulfilled” either; the act of **creating a fulfillment** is what fulfills items.

*(Note: the tool passages available here don’t include the REST endpoint shapes/payload fields, so this section stays at the conceptual + process level.)*

---

## **Common failure points / checks**

- **Fulfillment order is on hold**: if it’s **`ON_HOLD`**, fulfillment creation can fail.
  - Check `supportedActions` for **`CREATE_FULFILLMENT`** before calling **`fulfillmentCreateV`**.

- **Wrong “unit”**: you used an **Order ID** where the API expects a **Fulfillment Order ID**.
  - Both submitting a request and creating the fulfillment described above work from a **Fulfillment Order ID**.

---

## **Quick decision guide**

- **You fulfill yourself (manual / in-house)**:
  - Get **Fulfillment Order ID**
  - Ensure it supports **`CREATE_FULFILLMENT`**
  - Call **`fulfillmentCreateV`**

- **A fulfillment service fulfills**:
  - Get **Fulfillment Order ID**
  - Submit request via **`fulfillmentOrderSubmitFulfillmentRequest`**
  - Then create fulfillment (or let the service do it, depending on your integration)

---
