import { useParams } from "react-router-dom";
import { TableClient } from "@/components/table/table-client";

export function TablePage() {
  const { tableId } = useParams<{ tableId: string }>();
  if (!tableId) return null;
  return <TableClient tableId={tableId} />;
}
