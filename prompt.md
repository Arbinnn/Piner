//@version=6
indicator("Custom HMA Signals", overlay=true, max_labels_count=500)

// ==========================
// INPUTS
// ==========================
hmaLength      = input.int(55, "HMA Length", minval=2)
src            = input.source(close, "Source")

showSignals    = input.bool(true, "Show Buy/Sell Signals")
showHMA        = input.bool(true, "Show HMA")
colorCandles   = input.bool(false, "Color Candles")

bullColor      = input.color(color.lime, "Bull Color")
bearColor      = input.color(color.red, "Bear Color")
neutralColor   = input.color(color.gray, "Neutral Color")

// ==========================
// HMA FUNCTION
// ==========================
hma(_src, _length) =>
    ta.wma(
        2 * ta.wma(_src, math.round(_length / 2))
        - ta.wma(_src, _length),
        math.round(math.sqrt(_length))
    )

hmaValue = hma(src, hmaLength)

// ==========================
// TREND
// ==========================
bullTrend = hmaValue > hmaValue[1]
bearTrend = hmaValue < hmaValue[1]

hmaColor =
     bullTrend ? bullColor :
     bearTrend ? bearColor :
     neutralColor

// ==========================
// SIGNALS
// ==========================
buySignal =
     ta.crossover(close, hmaValue) and bullTrend

sellSignal =
     ta.crossunder(close, hmaValue) and bearTrend

// ==========================
// PLOTS
// ==========================
plot(showHMA ? hmaValue : na,
     title="Hull MA",
     color=hmaColor,
     linewidth=3)

plotshape(
     showSignals and buySignal,
     title="BUY",
     style=shape.labelup,
     text="BUY",
     location=location.belowbar,
     color=bullColor,
     textcolor=color.white,
     size=size.small)

plotshape(
     showSignals and sellSignal,
     title="SELL",
     style=shape.labeldown,
     text="SELL",
     location=location.abovebar,
     color=bearColor,
     textcolor=color.white,
     size=size.small)

// ==========================
// CANDLE COLORS
// ==========================
barcolor(colorCandles ?
     bullTrend ? bullColor :
     bearTrend ? bearColor :
     na : na)

// ==========================
// ALERTS
// ==========================
alertcondition(
     buySignal,
     title="HMA BUY",
     message="BUY Signal")

alertcondition(
     sellSignal,
     title="HMA SELL",
     message="SELL Signal")

     it doesnt show buy and sell signals
     