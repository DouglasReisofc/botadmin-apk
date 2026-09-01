import { sendPlanPurchaseNotification } from "lib/notifications";
import { sendPurchaseSupportMessage } from "lib/support-automation";
import { getUserBasicById } from "lib/users";

export const notifyPlanPaymentCompleted = async ({
  userId,
  planName,
  amount,
  paymentReference,
}: {
  userId: number;
  planName: string;
  amount: number;
  paymentReference?: string | null;
}): Promise<boolean> => {
  const user = await getUserBasicById(userId);
  if (!user) {
    return false;
  }

  await sendPlanPurchaseNotification({
    planName,
    amount,
    buyerName: user.name,
    buyerEmail: user.email,
    buyerUserId: user.id,
    paymentReference: paymentReference ?? null,
  });

  await sendPurchaseSupportMessage({
    userId: user.id,
    userName: user.name,
    productName: planName,
    amount,
  });

  return true;
};
