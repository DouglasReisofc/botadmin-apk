"use client";
//import node modules libraries
import { useEffect } from "react";
import Offcanvas from "react-bootstrap/Offcanvas";
import OffcanvasBody from "react-bootstrap/OffcanvasBody";
import OffcanvasHeader from "react-bootstrap/OffcanvasHeader";
import { usePathname } from "next/navigation";

//import custom components
import Sidebar from "./Sidebar";

//import custom hooks
import useMenu from "hooks/useMenu";
import { getAssetPath } from "helper/assetPath";

interface OffcanvasSidebarProps {
  role: "admin" | "user";
  siteSettings?: {
    siteName: string;
    logoUrl: string | null;
  };
}

const OffcanvasSidebar = ({ role, siteSettings }: OffcanvasSidebarProps) => {
  const { showMenu, toggleMenuHandler } = useMenu();
  const pathname = usePathname();

  useEffect(() => {
    if (!showMenu) {
      return;
    }
    toggleMenuHandler(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <Offcanvas
      placement={"start"}
      show={showMenu}
      onHide={() => toggleMenuHandler(false)}
      backdrop={true}
      bsPrefix="offcanvasNav offcanvas offcanvas-start "
    >
      <OffcanvasHeader closeButton />
      <OffcanvasBody className="p-0 ">
        <Sidebar hideLogo={false} role={role} />
      </OffcanvasBody>
    </Offcanvas>
  );
};

export default OffcanvasSidebar;
