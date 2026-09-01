//import node modules libraries
import React from "react";
import { Navbar, Pagination } from "react-bootstrap";
import { ChevronLeft, ChevronRight } from "react-feather";
import { Table as ReactTable, RowData } from "@tanstack/react-table";

interface TablePaginationProps<TData extends RowData> {
  table: ReactTable<TData>;
  hasIcon?: boolean;
}

const TablePagination = <TData extends RowData>({
  table,
  hasIcon,
}: TablePaginationProps<TData>) => {
  const pageSize = table.options.state.pagination?.pageSize ?? 10;
  const pageIndex = table.options.state.pagination?.pageIndex ?? 0;
  const pageCount = table.getPageCount();
  const totalRows = table.getFilteredRowModel().rows.length;

  return (
    <div className="border-top d-md-flex justify-content-between align-items-center p-3">
      <div>
        Showing {pageIndex * pageSize + 1} to{" "}
        {Math.min((pageIndex + 1) * pageSize, totalRows)} of {totalRows} entries
      </div>
      <Navbar className="mt-2 mt-md-0">
        <Pagination className="mb-0">
          {/* Previous Button */}
          <Pagination.Item
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            {hasIcon ? <ChevronLeft className="icon-xxs" /> : "Previous"}
          </Pagination.Item>

          {/* Page Numbers */}
          {Array.from(Array(pageCount).keys()).map((page) => (
            <Pagination.Item
              key={page}
              active={pageIndex === page}
              onClick={() => table.setPageIndex(page)}
            >
              {page + 1}
            </Pagination.Item>
          ))}

          {/* Next Button */}
          <Pagination.Item
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            {hasIcon ? <ChevronRight className="icon-xxs" /> : "Next"}
          </Pagination.Item>
        </Pagination>
      </Navbar>
    </div>
  );
};

export default TablePagination;
