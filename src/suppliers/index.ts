import type { Env, PurchaseOrderLine, Supplier } from '../types';

export interface SupplierResult {
  placed: boolean;
  message: string;
}

/** 공급처별 자동 발주. manual은 텔레그램 발주서로 대신하고, 쿠팡은 추후 구현 */
export interface SupplierAdapter {
  placeOrder(env: Env, lines: PurchaseOrderLine[]): Promise<SupplierResult>;
}

const manual: SupplierAdapter = {
  async placeOrder() {
    return { placed: false, message: '텔레그램 발주서로 직접 발주' };
  },
};

const coupang: SupplierAdapter = {
  async placeOrder() {
    // TODO: 쿠팡 자동주문 연동. 구매자용 공개 API가 없어 연동 방식부터 확정 필요.
    return { placed: false, message: '쿠팡 자동주문 미구현' };
  },
};

export const suppliers: Record<Supplier, SupplierAdapter> = { manual, coupang };
