"use client";
// import node module libraries
import React, { Fragment, useState } from "react";
import { Table } from "react-bootstrap";
import { ChevronUp, ChevronDown } from "react-feather";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  ColumnDef,
  SortingState,
  RowSelectionState,
} from "@tanstack/react-table";

// import custom components
import GlobalFilter from "./GlobalFilter";
import TablePagination from "./TablePagination";

interface TanstackTableProps<TData> {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
  filter?: boolean;
  pagination?: boolean;
  filterPlaceholder?: string;
  header?: boolean;
  onRowClick?: (row: TData) => void;
  showIcon?: boolean;
  className?: string;
  tableClass?: string;
  tdClass?: string;
  isSortable?: boolean;
}

function TanstackTable<TData>({
  data,
  columns,
  filter = false,
  pagination = false,
  filterPlaceholder,
  header = true,
  onRowClick,
  showIcon,
  className,
  tableClass,
  tdClass,
  isSortable = false,
  ...props
}: TanstackTableProps<TData>) {
  const [filtering, setFiltering] = useState<string>("");
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable<TData>({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    enableSorting: isSortable,
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      globalFilter: filtering,
      rowSelection: rowSelection,
      sorting,
    },
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onRowSelectionChange: setRowSelection,
    enableRowSelection: true,
    onGlobalFilterChange: setFiltering,
    debugTable: false,
  });

  const hasTableData = Array.isArray(data) && data?.length > 0;

  if (!hasTableData) {
    return (
      <div className="text-center p-5">
        <p className="text-muted mb-0">No data available</p>
      </div>
    );
  }
  return (
    <Fragment>
      {filter && (
        <GlobalFilter
          filtering={filtering}
          setFiltering={setFiltering}
          placeholder={filterPlaceholder}
          table={table}
        />
      )}

      <div className={className ? className : "table-responsive table-card"}>
        <Table
          className={
            tableClass ? tableClass : "text-nowrap table-centered mt-0"
          }
          style={{ width: "100%" }}
          id="example"
          {...props}
        >
          {header && (
            <thead className="bg-light">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      colSpan={header.colSpan}
                    >
                      {header.isPlaceholder ? null : (
                        <div
                          {...{
                            className: header.column.getCanSort()
                              ? "sorting"
                              : "",
                          }}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                          {{
                            asc: <ChevronUp size={16} />,
                            desc: <ChevronDown size={16} />,
                          }[header.column.getIsSorted() as string] ?? null}
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
          )}

          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onClick={
                  onRowClick ? () => onRowClick(row.original) : undefined
                }
                style={onRowClick ? { cursor: "pointer" } : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className={tdClass}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      {pagination && <TablePagination table={table} hasIcon={showIcon} />}
    </Fragment>
  );
}

export default TanstackTable;
