//@version=4
strategy(
     "Rob Booker - ADX Breakout",
     shorttitle="ADX Breakout",
     overlay=true
)

//---------------------------------------------------------
// Inputs
//---------------------------------------------------------

adxSmoothPeriod = input(14, title="ADX Smoothing Period")
adxPeriod = input(14, title="ADX Period")
adxLowerLevel = input(18, title="ADX Lower Level")

profitTargetMultiple = input(
     1.0,
     title="Profit Target Box Width Multiple"
)

stopLossMultiple = input(
     0.5,
     title="Stop Loss Box Width Multiple"
)

boxLookBack = input(
     20,
     title="BreakoutBox Lookback Period"
)

enableDirection = input(
     0,
     title="Both(0), Long(1), Short(-1)"
)

//---------------------------------------------------------
// Directional Movement
//---------------------------------------------------------

dirmov(len) =>
    up = change(high)
    down = -change(low)

    truerange = rma(tr(true), len)

    plus = fixnan(
         100 * rma(
             up > down and up > 0 ? up : 0,
             len
         ) / truerange
    )

    minus = fixnan(
         100 * rma(
             down > up and down > 0 ? down : 0,
             len
         ) / truerange
    )

    [plus, minus]

//---------------------------------------------------------
// ADX
//---------------------------------------------------------

adx(dilen, adxlen) =>
    [plus, minus] = dirmov(dilen)

    sum = plus + minus

    adxValue = 100 * rma(
         abs(plus - minus) /
         (sum == 0 ? 1 : sum),
         adxlen
    )

    adxValue

//---------------------------------------------------------
// Optional Directional Components
//---------------------------------------------------------

adxHigh(dilen, adxlen) =>
    [plus, minus] = dirmov(dilen)
    plus

adxLow(dilen, adxlen) =>
    [plus, minus] = dirmov(dilen)
    minus

//---------------------------------------------------------
// ADX Condition
//---------------------------------------------------------

sig = adx(
     adxSmoothPeriod,
     adxPeriod
)

isADXLow = sig < adxLowerLevel

//---------------------------------------------------------
// Breakout Box
//---------------------------------------------------------

var float boxUpperLevel = na
var float boxLowerLevel = na

if strategy.position_size == 0
    boxUpperLevel := highest(high, boxLookBack)[1]
    boxLowerLevel := lowest(low, boxLookBack)[1]
else
    boxUpperLevel := boxUpperLevel[1]
    boxLowerLevel := boxLowerLevel[1]

boxWidth = boxUpperLevel - boxLowerLevel

//---------------------------------------------------------
// Take Profit
//---------------------------------------------------------

profitTarget =
     strategy.position_size > 0 ?
     strategy.position_avg_price +
     profitTargetMultiple * boxWidth :
     strategy.position_size < 0 ?
     strategy.position_avg_price -
     profitTargetMultiple * boxWidth :
     na

//---------------------------------------------------------
// Stop Loss
//---------------------------------------------------------

stopLoss =
     strategy.position_size > 0 ?
     strategy.position_avg_price -
     stopLossMultiple * boxWidth :
     strategy.position_size < 0 ?
     strategy.position_avg_price +
     stopLossMultiple * boxWidth :
     na

//---------------------------------------------------------
// Box Plots
//---------------------------------------------------------

plot(
     boxUpperLevel,
     title="Box Upper Level",
     color=#000000,
     linewidth=1
)

plot(
     boxLowerLevel,
     title="Box Lower Level",
     color=#000000,
     linewidth=1
)

// Highlight consolidation
bgcolor(
     isADXLow ? #800080 : na,
     transp=85
)

// Stop loss
plot(
     stopLoss,
     color=#FF0000,
     linewidth=2,
     title="StopLossLine"
)

// Profit target
plot(
     profitTarget,
     color=#0000FF,
     linewidth=2,
     title="ProfitTargetLine"
)

//---------------------------------------------------------
// Entry Conditions
//---------------------------------------------------------

isBuyValid =
     strategy.position_size == 0 and
     crossover(close, boxUpperLevel) and
     isADXLow

isSellValid =
     strategy.position_size == 0 and
     crossunder(close, boxLowerLevel) and
     isADXLow

//---------------------------------------------------------
// Long Entry
//---------------------------------------------------------

entry_long =
     isBuyValid and
     strategy.opentrades == 0 and
     (enableDirection == 1 or enableDirection == 0)

strategy.entry(
     "open_long",
     strategy.long,
     when=entry_long
)

strategy.exit(
     id="close_long",
     from_entry="open_long",
     stop=stopLoss,
     limit=profitTarget
)

//---------------------------------------------------------
// Short Entry
//---------------------------------------------------------

entryShort =
     isSellValid and
     strategy.opentrades == 0 and
     (enableDirection == -1 or enableDirection == 0)

strategy.entry(
     "open_short",
     strategy.short,
     when=entryShort
)

strategy.exit(
     id="close_short",
     from_entry="open_short",
     stop=stopLoss,
     limit=profitTarget
)