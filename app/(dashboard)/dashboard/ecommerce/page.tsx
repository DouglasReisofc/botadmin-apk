//import node module libraries
import { Fragment } from "react";
import { Metadata } from "next";

//import custom components
import ProductListing from "components/ecommerce/ProductListing";
import EcommerceHeader from "components/ecommerce/EcommerceHeader";

export const metadata: Metadata = {
  title: "Catálogo | StoreBot Dashboard",
  description: "Gerencie produtos, preços e estoque em tempo real.",
};

const Ecommerce = () => {
  return (
    <Fragment>
      <EcommerceHeader />
      <ProductListing />
    </Fragment>
  );
};

export default Ecommerce;
