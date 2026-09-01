"use client";
// import node module libraries
import { FormCheckType } from "react-bootstrap/esm/FormCheck";
import { useRef, useEffect, InputHTMLAttributes } from "react";
import { FormCheck } from "react-bootstrap";

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  indeterminate?: boolean;
  className?: string;
  type?: FormCheckType;
}

const Checkbox = ({
  indeterminate,
  className = "",
  type = "checkbox",
  ...rest
}: CheckboxProps) => {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof indeterminate === "boolean" && ref.current) {
      ref.current.indeterminate = !rest.checked && indeterminate;
    }
  }, [ref, indeterminate, rest.checked]);

  // Exclude 'type' from rest to avoid conflicts with FormCheck's allowed types
  const { ...restWithoutType } = rest;

  return (
    <FormCheck
      type={type}
      ref={ref}
      className={className}
      {...restWithoutType}
    />
  );
};
export default Checkbox;
