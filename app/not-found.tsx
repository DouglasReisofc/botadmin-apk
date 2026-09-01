import { getAssetPath } from "helper/assetPath";

import ErrorLayout from "./(error)/layout";
import NotFoundClient from "./(error)/not-found/NotFoundClient";

export { metadata } from "./(error)/not-found/page";

const NotFound = () => {
  return (
    <ErrorLayout>
      <NotFoundClient assetPath={getAssetPath("/images/svg/404.svg")} />
    </ErrorLayout>
  );
};

export default NotFound;
