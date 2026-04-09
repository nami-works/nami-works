import { useEffect, useState } from "react";
import {
  reactExtension,
  useApi,
  AdminAction,
  BlockStack,
  Button,
  Text,
  Banner,
} from "@shopify/ui-extensions-react/admin";

const TARGET = "admin.order-details.action.render";

export default reactExtension(TARGET, () => <ReturnPickupAction />);

function ReturnPickupAction() {
  const { data, close, fetch } = useApi(TARGET);
  const orderId = data.selected?.[0]?.id;

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    alreadyExists?: boolean;
    error?: string;
  } | null>(null);

  const handleSubmit = async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const response = await fetch("/app/api/return-pickup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const json = await response.json();
      setResult(json);
    } catch (err) {
      setResult({ ok: false, error: "Failed to submit return request." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (result?.ok && !result.alreadyExists) {
      const timer = setTimeout(() => close(), 1500);
      return () => clearTimeout(timer);
    }
  }, [result, close]);

  if (result?.ok && result.alreadyExists) {
    return (
      <AdminAction
        title="Request return"
        secondaryAction={<Button onPress={close}>Close</Button>}
      >
        <BlockStack gap="base">
          <Banner tone="info">
            A return pickup request already exists for this order.
          </Banner>
        </BlockStack>
      </AdminAction>
    );
  }

  if (result?.ok) {
    return (
      <AdminAction title="Request return">
        <BlockStack gap="base">
          <Banner tone="success">
            Return pickup request created successfully.
          </Banner>
        </BlockStack>
      </AdminAction>
    );
  }

  return (
    <AdminAction
      title="Request return"
      primaryAction={
        <Button onPress={handleSubmit} loading={loading}>
          Request return
        </Button>
      }
      secondaryAction={<Button onPress={close}>Cancel</Button>}
    >
      <BlockStack gap="base">
        {result?.error ? (
          <Banner tone="critical">{result.error}</Banner>
        ) : null}
        <Text>
          Request a return pickup for this order? The return will appear in the
          Local Delivery screen for dispatch.
        </Text>
      </BlockStack>
    </AdminAction>
  );
}
