import { Decimal } from '../../common/decimal';

/**
 * Pure stock valuation for one item in one warehouse.
 *  - weighted_average: incoming value is added to the pool; issues go out at value / qty.
 *  - fifo: incoming stock forms cost layers; issues consume the oldest layers first.
 * Quantities are in base units (4 dp), values in rupees (2 dp), rates 6 dp.
 */

export type Method = 'weighted_average' | 'fifo';
export interface Layer {
  qty: string;
  rate: string;
}
export interface Pool {
  qty: string;
  value: string;
  layers: Layer[];
}
export interface Movement {
  pool: Pool;
  /** Signed value of the movement (+ in, − out). */
  value: string;
  /** Rate per base unit of the movement. */
  rate: string;
  /** Pool rate after the movement (value / qty, or last rate when empty). */
  valuationRate: string;
}

const D = Decimal.from;
const q4 = (d: Decimal) => d.toFixed(4);
const v2 = (d: Decimal) => d.toFixed(2);
const r6 = (d: Decimal) => d.toFixed(6);

function rateOf(value: Decimal, qty: Decimal, fallback = '0'): string {
  if (qty.isZero()) return fallback;
  return r6(Decimal.fromRatio(value, qty));
}

export function receive(pool: Pool, method: Method, qtyIn: string, rateIn: string): Movement {
  const qty = D(qtyIn);
  if (qty.isNegative() || qty.isZero()) throw new Error('receive() needs a positive quantity');
  const rate = D(rateIn);
  const value = qty.mul(rate);
  const newQty = D(pool.qty).add(qty);
  const newValue = D(pool.value).add(D(v2(value)));
  let layers = pool.layers;
  if (method === 'fifo') {
    // Receiving into a negative position first clears the shortfall.
    layers = D(pool.qty).isNegative() ? [] : [...pool.layers];
    const remaining = D(pool.qty).isNegative() ? newQty : qty;
    if (!remaining.isNegative() && !remaining.isZero()) layers.push({ qty: q4(remaining), rate: r6(rate) });
  }
  const next = { qty: q4(newQty), value: v2(newValue), layers };
  return { pool: next, value: v2(value), rate: r6(rate), valuationRate: rateOf(newValue, newQty, r6(rate)) };
}

export function issue(pool: Pool, method: Method, qtyOut: string): Movement {
  const qty = D(qtyOut);
  if (qty.isNegative() || qty.isZero()) throw new Error('issue() needs a positive quantity');
  const poolQty = D(pool.qty);
  const poolValue = D(pool.value);

  let outValue: Decimal;
  let layers = pool.layers;
  if (method === 'fifo' && pool.layers.length) {
    outValue = D('0');
    let need = qty;
    layers = [];
    for (const layer of pool.layers) {
      const lq = D(layer.qty);
      if (need.isZero()) {
        layers.push(layer);
        continue;
      }
      if (lq.cmp(need) <= 0) {
        outValue = outValue.add(lq.mul(D(layer.rate)));
        need = need.sub(lq);
      } else {
        outValue = outValue.add(need.mul(D(layer.rate)));
        layers.push({ qty: q4(lq.sub(need)), rate: layer.rate });
        need = D('0');
      }
    }
    // Issuing beyond layers (negative stock allowed): price the shortfall at the last rate.
    if (!need.isZero()) {
      const last = pool.layers[pool.layers.length - 1]?.rate ?? '0';
      outValue = outValue.add(need.mul(D(last)));
    }
  } else {
    // Weighted average (or FIFO with no layers): current average rate.
    const avg = poolQty.isZero() || poolQty.isNegative() ? D('0') : Decimal.fromRatio(poolValue, poolQty);
    outValue = qty.cmp(poolQty) === 0 ? poolValue : qty.mul(avg); // last unit takes the remaining paise
  }

  const outV = D(v2(outValue));
  const newQty = poolQty.sub(qty);
  const newValue = poolValue.sub(outV);
  const movementRate = rateOf(outV, qty);
  return {
    pool: { qty: q4(newQty), value: v2(newValue), layers: method === 'fifo' ? layers : [] },
    value: v2(D('0').sub(outV)),
    rate: movementRate,
    valuationRate: rateOf(newValue, newQty, movementRate),
  };
}

/** Reverses a past movement at its original value (used when a voucher is cancelled). */
export function reverse(pool: Pool, method: Method, qtySigned: string, valueSigned: string): Movement {
  const qty = D(qtySigned);
  const value = D(valueSigned);
  const newQty = D(pool.qty).sub(qty);
  const newValue = D(pool.value).sub(value);
  let layers = pool.layers;
  if (method === 'fifo') {
    const absQty = qty.isNegative() ? D('0').sub(qty) : qty;
    const absValue = value.isNegative() ? D('0').sub(value) : value;
    const rate = absQty.isZero() ? '0' : r6(Decimal.fromRatio(absValue, absQty));
    if (qty.isNegative()) {
      // Undoing an issue: put the stock back as the oldest layer.
      layers = [{ qty: q4(absQty), rate }, ...pool.layers];
    } else {
      // Undoing a receipt: remove the same quantity from the newest layers.
      let need = absQty;
      layers = [];
      for (const layer of [...pool.layers].reverse()) {
        const lq = D(layer.qty);
        if (need.isZero()) layers.unshift(layer);
        else if (lq.cmp(need) <= 0) need = need.sub(lq);
        else {
          layers.unshift({ qty: q4(lq.sub(need)), rate: layer.rate });
          need = D('0');
        }
      }
    }
  }
  const absQ = qty.isNegative() ? D('0').sub(qty) : qty;
  const absV = value.isNegative() ? D('0').sub(value) : value;
  return {
    pool: { qty: q4(newQty), value: v2(newValue), layers },
    value: v2(D('0').sub(value)),
    rate: rateOf(absV, absQ),
    valuationRate: rateOf(newValue, newQty, rateOf(absV, absQ)),
  };
}

/**
 * Value-only change (landed cost, purchase price difference): quantity stays, value moves.
 * FIFO spreads the change over the layers in proportion to their quantity.
 * A pool with no stock can't absorb value; the caller treats it as unabsorbed.
 */
export function revalue(pool: Pool, method: Method, valueSigned: string): Movement {
  const qty = D(pool.qty);
  const change = D(v2(D(valueSigned)));
  if (qty.isZero() || qty.isNegative()) {
    return { pool, value: '0.00', rate: '0', valuationRate: rateOf(D(pool.value), qty) };
  }
  const newValue = D(pool.value).add(change);
  let layers = pool.layers;
  if (method === 'fifo' && pool.layers.length) {
    const perUnit = change.div(qty);
    layers = pool.layers.map((l) => ({ qty: l.qty, rate: r6(D(l.rate).add(perUnit)) }));
  }
  return { pool: { qty: pool.qty, value: v2(newValue), layers }, value: v2(change), rate: '0', valuationRate: rateOf(newValue, qty) };
}
