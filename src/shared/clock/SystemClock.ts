import type { ClockInterface } from "./interfaces/ClockInterface.js";
export class SystemClock implements ClockInterface { now(): number { return Date.now(); } }
