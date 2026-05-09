import { List } from "@shopify/polaris";

export default function FeatureList({ items = [] }) {
  return (
      <List type="bullet">
        {items.map((item) => (
            <List.Item key={item}>{item}</List.Item>
        ))}
      </List>
  );
}