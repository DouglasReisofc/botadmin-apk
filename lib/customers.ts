
export type CustomerSummary = {
  id: number;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  balance: number;
  isBlocked: boolean;
  createdAt: string;
};

export class CustomerStoreDisabledError extends Error {
  status: number;

  constructor(message = "O gerenciamento de clientes foi desativado no novo dashboard.") {
    super(message);
    this.name = "CustomerStoreDisabledError";
    this.status = 410;
  }
}

const emptyCustomers: CustomerSummary[] = [];

export const getCustomersForUser = async (_userId: number): Promise<CustomerSummary[]> => {
  void _userId;
  return emptyCustomers;
};

export const findCustomerByPhoneForUser = async (_userId: number, _phone: string) => {
  void _userId;
  void _phone;
  return null;
};

export const findCustomerByWhatsappForUser = async (_userId: number, _whatsapp: string) => {
  void _userId;
  void _whatsapp;
  return null;
};

export const findCustomerByWhatsappId = async (_userId: number, _whatsapp: string) => {
  void _userId;
  void _whatsapp;
  return null;
};

export const getCustomerByIdForUser = async (_userId: number, _customerId: number) => {
  void _userId;
  void _customerId;
  return null;
};

export const updateCustomerForUser = async () => {
  throw new CustomerStoreDisabledError();
};

export const upsertCustomerInteraction = async () => {
  return;
};

export const creditCustomerBalanceByWhatsapp = async () => {
  return;
};

export const debitCustomerBalanceByWhatsapp = async () => {
  return;
};
