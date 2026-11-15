import { TableClient } from "@/components/table/table-client";

export default function TablePage({ params }: { params: { tableId: string } }) {
  return <TableClient tableId={params.tableId} />;
}
