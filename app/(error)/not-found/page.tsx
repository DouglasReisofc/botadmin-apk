//import node modules libraries
import { getAssetPath } from "helper/assetPath";
import { Metadata } from "next";
import NotFoundClient from "./NotFoundClient";

export const metadata: Metadata = {
  title: "404 error | Bot Admin - Gestor de grupos",
  description: "Bot Admin - Gestor de grupos - Página não encontrada",
};

const NotFound = () => {
  return <NotFoundClient assetPath={getAssetPath("/images/svg/404.svg")} />;
};

export default NotFound;
