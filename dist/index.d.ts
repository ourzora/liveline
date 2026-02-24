import * as react_jsx_runtime from 'react/jsx-runtime';
import { CSSProperties, ReactElement } from 'react';

interface LivelinePoint {
    time: number;
    value: number;
}
type Momentum = 'up' | 'down' | 'flat';
type ThemeMode = 'light' | 'dark';
type WindowStyle = 'default' | 'rounded' | 'text';
type BadgeVariant = 'default' | 'minimal';
interface ReferenceLine {
    value: number;
    label?: string;
}
interface HoverPoint {
    time: number;
    value: number;
    x: number;
    y: number;
}
interface Padding {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
}
interface WindowOption {
    label: string;
    secs: number;
}
interface OrderbookData {
    bids: [number, number][];
    asks: [number, number][];
}
interface DegenOptions {
    /** Multiplier for particle count and size (default 1) */
    scale?: number;
    /** Show particles on down-momentum swings (default false) */
    downMomentum?: boolean;
}
interface LivelineProps {
    data: LivelinePoint[];
    value: number;
    theme?: ThemeMode;
    color?: string;
    window?: number;
    grid?: boolean;
    badge?: boolean;
    momentum?: boolean | Momentum;
    fill?: boolean;
    loading?: boolean;
    paused?: boolean;
    emptyText?: string;
    scrub?: boolean;
    exaggerate?: boolean;
    showValue?: boolean;
    valueMomentumColor?: boolean;
    degen?: boolean | DegenOptions;
    badgeTail?: boolean;
    windows?: WindowOption[];
    onWindowChange?: (secs: number) => void;
    windowStyle?: WindowStyle;
    badgeVariant?: BadgeVariant;
    tooltipY?: number;
    tooltipOutline?: boolean;
    orderbook?: OrderbookData;
    referenceLine?: ReferenceLine;
    formatValue?: (v: number) => string;
    formatTime?: (t: number) => string;
    lerpSpeed?: number;
    padding?: Padding;
    onHover?: (point: HoverPoint | null) => void;
    cursor?: string;
    pulse?: boolean;
    mode?: 'line' | 'candle';
    candles?: CandlePoint[];
    candleWidth?: number;
    bullColor?: string;
    bearColor?: string;
    liveCandle?: CandlePoint;
    lineMode?: boolean;
    lineData?: LivelinePoint[];
    lineValue?: number;
    onModeChange?: (mode: 'line' | 'candle') => void;
    className?: string;
    style?: CSSProperties;
}
interface CandlePoint {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
}

declare function Liveline({ data, value, theme, color, window: windowSecs, grid, badge, momentum, fill, scrub, loading, paused, emptyText, exaggerate, degen: degenProp, badgeTail, badgeVariant, showValue, valueMomentumColor, windows, onWindowChange, windowStyle, tooltipY, tooltipOutline, orderbook, referenceLine, formatValue, formatTime, lerpSpeed, padding: paddingOverride, onHover, cursor, pulse, mode, candles, candleWidth, bullColor, bearColor, liveCandle, lineMode, lineData, lineValue, onModeChange, className, style, }: LivelineProps): react_jsx_runtime.JSX.Element;

interface LivelineTransitionProps {
    /** Key of the active child to display. Must match a child's `key` prop. */
    active: string;
    /** Chart elements with unique `key` props */
    children: ReactElement | ReactElement[];
    /** Cross-fade duration in ms (default 300) */
    duration?: number;
    className?: string;
    style?: CSSProperties;
}
/**
 * Cross-fade between chart components (e.g. line ↔ candlestick).
 * Children must have unique `key` props matching possible `active` values.
 *
 * @example
 * ```tsx
 * <LivelineTransition active={chartType}>
 *   <Liveline key="line" data={data} value={value} />
 *   <Liveline key="candle" mode="candle" candles={candles} candleWidth={5} data={data} value={value} />
 * </LivelineTransition>
 * ```
 */
declare function LivelineTransition({ active, children, duration, className, style, }: LivelineTransitionProps): react_jsx_runtime.JSX.Element;

export { type BadgeVariant, type CandlePoint, type DegenOptions, type HoverPoint, Liveline, type LivelinePoint, type LivelineProps, LivelineTransition, type LivelineTransitionProps, type Momentum, type OrderbookData, type Padding, type ReferenceLine, type ThemeMode, type WindowOption, type WindowStyle };
