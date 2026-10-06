import { Decimal } from '../../common/decimal';

const D = Decimal.from;
const HUNDRED = D('100');

export interface DutyInput {
  /** Assessable value in ₹ (CIF × exchange rate, as assessed by customs). */
  assessableValue: string;
  bcdRate: string;
  /** Social Welfare Surcharge, % of BCD (10% for most goods). */
  swsRate: string;
  igstRate: string;
  /** GST compensation cess %. */
  cessRate: string;
}

export interface Duty {
  assessableValue: string;
  bcdAmount: string;
  swsAmount: string;
  igstAmount: string;
  cessAmount: string;
  /** BCD + SWS: a cost (not creditable). */
  customsDuty: string;
  /** IGST + cess: claimable as ITC on imports. */
  creditable: string;
  total: string;
}

/**
 * Customs duty on one Bill of Entry item. BCD on the assessable value, SWS on BCD, then IGST
 * and cess on (assessable value + BCD + SWS). Customs rounds each duty to the rupee.
 */
export function computeDuty(i: DutyInput): Duty {
  const av = D(i.assessableValue).round(2);
  const bcd = av.mul(D(i.bcdRate)).div(HUNDRED).round(0);
  const sws = bcd.mul(D(i.swsRate)).div(HUNDRED).round(0);
  const base = av.add(bcd).add(sws);
  const igst = base.mul(D(i.igstRate)).div(HUNDRED).round(0);
  const cess = base.mul(D(i.cessRate)).div(HUNDRED).round(0);
  return {
    assessableValue: av.toFixed(2),
    bcdAmount: bcd.toFixed(2),
    swsAmount: sws.toFixed(2),
    igstAmount: igst.toFixed(2),
    cessAmount: cess.toFixed(2),
    customsDuty: bcd.add(sws).toFixed(2),
    creditable: igst.add(cess).toFixed(2),
    total: bcd.add(sws).add(igst).add(cess).toFixed(2),
  };
}
