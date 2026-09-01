"use client";
//import node modules libraries
import { Provider } from "react-redux";

//import redux store
import store from "store/store";
import SupportNotificationListener from "components/common/SupportNotificationListener";
import SupportFloatingBubble from "components/support/SupportFloatingBubble";
import UserSupportLauncher from "components/support/UserSupportLauncher";
import AdminSupportLauncher from "components/support/AdminSupportLauncher";
import AudioStatusBadge from "components/common/AudioStatusBadge";
import NativeUpdateChecker from "components/mobile/NativeUpdateChecker";
import SessionKeeper from "components/common/SessionKeeper";

const ClientWrapper = ({ children }: { children: React.ReactNode }) => {
  return (
    <Provider store={store}>
      <SupportNotificationListener />
      <SessionKeeper />
      <AudioStatusBadge />
      <SupportFloatingBubble />
      <UserSupportLauncher />
      <AdminSupportLauncher />
      <NativeUpdateChecker />
      {children}
    </Provider>
  );
};

export default ClientWrapper;
