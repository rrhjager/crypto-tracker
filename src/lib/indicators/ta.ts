export function ema(values: number[], period: number): number[] {
    const k = 2 / (period + 1);
    const out: number[] = []; let prev = values[0]; out.push(prev);
    for (let i=1; i<values.length; i++){ const v = values[i]*k + prev*(1-k); out.push(v); prev = v; }
    return out;
  }
  
  export function rsi(values: number[], period = 14): number[] {
    let gains = 0, losses = 0; const rsis: number[] = [];
    for (let i=1;i<values.length;i++){
      const d = values[i]-values[i-1];
      if (i <= period){ if (d>=0) gains += d; else losses -= d; rsis.push(NaN); continue; }
      if (i===period+1){
        const rs = (losses/period)===0 ? 100 : (gains/period)/(losses/period);
        rsis.push(100 - (100/(1+rs))); continue;
      }
      const gain = Math.max(0, d), loss = Math.max(0, -d);
      gains = (gains*(period-1) + gain) / period;
      losses = (losses*(period-1) + loss) / period;
      const rs = losses===0 ? 100 : gains/losses;
      rsis.push(100 - (100/(1+rs)));
    }
    rsis.unshift(NaN); return rsis;
  }
  
  export function macd(values: number[], fast=12, slow=26, signal=9) {
    const emaFast = ema(values, fast);
    const emaSlow = ema(values, slow);
    const macdLine = values.map((_,i)=> emaFast[i]-emaSlow[i]);
    const signalLine = ema(macdLine, signal);
    const hist = macdLine.map((m,i)=> m - signalLine[i]);
    return { macdLine, signalLine, hist };
  }