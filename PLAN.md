// This work is licensed under Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
// https://creativecommons.org/licenses/by-nc-sa/4.0/
// © Zeiierman {
//@version=6
indicator('SuperTrend Cluster (Zeiierman)', max_labels_count = 200, overlay = true, max_bars_back = 2000, behind_chart = false)
//}

// ~~ Tooltips {
var string t1  = "Minimum weighted agreement required for the bullish or bearish cluster to become valid. Higher values demand stronger alignment across the SuperTrend set."
var string t2  = "Selects which one of the five SuperTrend members is used as the base reference for flip markers, label placement, and final direction alignment."
var string t3  = "Colors the candles and bars using the live cluster strength gradient. When disabled, chart candles keep their default chart colors."
var string t4  = "Shows or hides the Bull Cluster and Bear Cluster labels when the selected base SuperTrend flips."
var string t5  = "Shows or hides the small base SuperTrend flip markers plotted at the selected base SuperTrend line."
var string t6  = "Main bullish color used for bullish trend lines, bullish labels, bullish markers, and bullish candle coloring."
var string t7  = "Main bearish color used for bearish trend lines, bearish labels, bearish markers, and bearish candle coloring."
var string t8  = "Neutral midpoint color used by the bar and candle gradient when bullish and bearish cluster pressure is balanced."

var string t9  = "ATR length for SuperTrend 1. Lower values react faster to price changes, while higher values make this member slower and smoother."
var string t10 = "ATR multiplier for SuperTrend 1. Higher values place the band farther from price and reduce sensitivity."
var string t11 = "Smoothing method applied to the source before SuperTrend 1 is calculated."
var string t12 = "Length of the smoothing used for SuperTrend 1. Higher values smooth more but add lag."
var string t13 = "Relative influence of SuperTrend 1 inside the weighted cluster. Higher values make this member contribute more to the final consensus."

var string t14 = "ATR length for SuperTrend 2. Lower values react faster to price changes, while higher values make this member slower and smoother."
var string t15 = "ATR multiplier for SuperTrend 2. Higher values place the band farther from price and reduce sensitivity."
var string t16 = "Smoothing method applied to the source before SuperTrend 2 is calculated."
var string t17 = "Length of the smoothing used for SuperTrend 2. Higher values smooth more but add lag."
var string t18 = "Relative influence of SuperTrend 2 inside the weighted cluster. Higher values make this member contribute more to the final consensus."

var string t19 = "ATR length for SuperTrend 3. Lower values react faster to price changes, while higher values make this member slower and smoother."
var string t20 = "ATR multiplier for SuperTrend 3. Higher values place the band farther from price and reduce sensitivity."
var string t21 = "Smoothing method applied to the source before SuperTrend 3 is calculated."
var string t22 = "Length of the smoothing used for SuperTrend 3. Higher values smooth more but add lag."
var string t23 = "Relative influence of SuperTrend 3 inside the weighted cluster. Higher values make this member contribute more to the final consensus."

var string t24 = "ATR length for SuperTrend 4. Lower values react faster to price changes, while higher values make this member slower and smoother."
var string t25 = "ATR multiplier for SuperTrend 4. Higher values place the band farther from price and reduce sensitivity."
var string t26 = "Smoothing method applied to the source before SuperTrend 4 is calculated."
var string t27 = "Length of the smoothing used for SuperTrend 4. Higher values smooth more but add lag."
var string t28 = "Relative influence of SuperTrend 4 inside the weighted cluster. Higher values make this member contribute more to the final consensus."

var string t29 = "ATR length for SuperTrend 5. Lower values react faster to price changes, while higher values make this member slower and smoother."
var string t30 = "ATR multiplier for SuperTrend 5. Higher values place the band farther from price and reduce sensitivity."
var string t31 = "Smoothing method applied to the source before SuperTrend 5 is calculated."
var string t32 = "Length of the smoothing used for SuperTrend 5. Higher values smooth more but add lag."
var string t33 = "Relative influence of SuperTrend 5 inside the weighted cluster. Higher values make this member contribute more to the final consensus."

var string t34 = "Fills the area between the active cluster SuperTrend line and a smoothed price reference with a translucent cloud."
var string t35 = "Length of the smoothing used for the hidden price reference that the cloud fills toward. Higher values create a steadier, softer cloud."
var string t36 = "Bullish cloud color used when the active cluster regime is bullish."
var string t37 = "Bearish cloud color used when the active cluster regime is bearish."
var string t38 = "Transparency of the cloud fill. Lower values are more solid, higher values are more subtle."
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~}

// ~~ INPUT PARAMETERS {
gCe = 'Cluster Engine'
thr = input.float(0.60, 'Consensus Threshold', minval = 0.0, maxval = 1.0, step = 0.01, group = gCe, tooltip = t1)
baseIx = input.int(3, 'Base SuperTrend Index', minval = 1, maxval = 5, group = gCe, tooltip = t2)

gVi = 'Visual Analytics'
useBc = input.bool(true, 'Dynamic Bar Coloring', group = gVi, tooltip = t3)
showLbl = input.bool(true, 'Show Cluster Labels', group = gVi, tooltip = t4)
showDot = input.bool(true, 'Show Base SuperTrend Flip Dots', group = gVi, tooltip = t5)

cBu = input.color(color.new(color.lime, 0), 'Bull', group = gVi, inline = 'col', tooltip = t6)
cBe = input.color(color.new(#f7525f, 0), 'Bear', group = gVi, inline = 'col', tooltip = t7)
cN  = input.color(color.new(#ff9800, 0), 'Neutral', group = gVi, inline = 'col', tooltip = t6 + "\n\n" + t7 + "\n\n" + t8)

gCf = 'Cloud Fill'
showCloud = input.bool(true, 'Show Cloud Fill', group = gCf, tooltip = t34)
cloudLen = input.int(8, 'Cloud Reference Length', minval = 1, group = gCf, tooltip = t35)
cCloudBu = input.color(color.new(color.lime, 0), 'Bull Cloud', group = gCf, inline = 'cf', tooltip = t36)
cCloudBe = input.color(color.new(#f7525f, 0), 'Bear Cloud', group = gCf, inline = 'cf', tooltip = t37)
cloudTransp = input.int(65, 'Cloud Transparency', minval = 0, maxval = 95, group = gCf, tooltip = t38)

// ~~ SuperTrend 1 {
gSt1 = 'SuperTrend 1'
a1 = input.int(7, 'ATR Length', minval = 1, group = gSt1, inline = '1', tooltip = t9)
f1 = input.float(1.5, 'Factor', minval = 0.01, step = 0.01, group = gSt1, inline = '1', tooltip = t9 + "\n\n" + t10)
m1 = input.string('EMA', 'Smoothing', options = ['SMA', 'EMA', 'LSMA', 'WMA', 'HMA', 'RMA'], group = gSt1, inline = '1.', tooltip = t11)
l1 = input.int(3, 'Length', minval = 1, group = gSt1, inline = '1.', tooltip = t11 + "\n\n" + t12)
w1 = input.float(1.0, 'Weight', minval = 0.0, step = 0.1, group = gSt1, inline = 'w1', tooltip = t13)
//}

// ~~ SuperTrend 2 {
gSt2 = 'SuperTrend 2'
a2 = input.int(10, 'ATR Length', minval = 1, group = gSt2, inline = '2', tooltip = t14)
f2 = input.float(2.0, 'Factor', minval = 0.01, step = 0.01, group = gSt2, inline = '2', tooltip = t14 + "\n\n" + t15)
m2 = input.string('EMA', 'Smoothing', options = ['SMA', 'EMA', 'LSMA', 'WMA', 'HMA', 'RMA'], group = gSt2, inline = '2.', tooltip = t16)
l2 = input.int(5, 'Length', minval = 1, group = gSt2, inline = '2.', tooltip = t16 + "\n\n" + t17)
w2 = input.float(1.0, 'Weight', minval = 0.0, step = 0.1, group = gSt2, inline = 'w2', tooltip = t18)
//}

// ~~ SuperTrend 3 {
gSt3 = 'SuperTrend 3'
a3 = input.int(14, 'ATR Length', minval = 1, group = gSt3, inline = '3', tooltip = t19)
f3 = input.float(2.5, 'Factor', minval = 0.01, step = 0.01, group = gSt3, inline = '3', tooltip = t19 + "\n\n" + t20)
m3 = input.string('SMA', 'Smoothing', options = ['SMA', 'EMA', 'LSMA', 'WMA', 'HMA', 'RMA'], group = gSt3, inline = '3.', tooltip = t21)
l3 = input.int(8, 'Length', minval = 1, group = gSt3, inline = '3.', tooltip = t21 + "\n\n" + t22)
w3 = input.float(1.2, 'Weight', minval = 0.0, step = 0.1, group = gSt3, inline = 'w3', tooltip = t23)
//}

// ~~ SuperTrend 4 {
gSt4 = 'SuperTrend 4'
a4 = input.int(21, 'ATR Length', minval = 1, group = gSt4, inline = '4', tooltip = t24)
f4 = input.float(3.0, 'Factor', minval = 0.01, step = 0.01, group = gSt4, inline = '4', tooltip = t24 + "\n\n" + t25)
m4 = input.string('WMA', 'Smoothing', options = ['SMA', 'EMA', 'LSMA', 'WMA', 'HMA', 'RMA'], group = gSt4, inline = '4.', tooltip = t26)
l4 = input.int(13, 'Length', minval = 1, group = gSt4, inline = '4.', tooltip = t26 + "\n\n" + t27)
w4 = input.float(1.4, 'Weight', minval = 0.0, step = 0.1, group = gSt4, inline = 'w4', tooltip = t28)
//}

// ~~ SuperTrend 5 {
gSt5 = 'SuperTrend 5'
a5 = input.int(34, 'ATR Length', minval = 1, group = gSt5, inline = '5', tooltip = t29)
f5 = input.float(4.0, 'Factor', minval = 0.01, step = 0.01, group = gSt5, inline = '5', tooltip = t29 + "\n\n" + t30)
m5 = input.string('HMA', 'Smoothing', options = ['SMA', 'EMA', 'LSMA', 'WMA', 'HMA', 'RMA'], group = gSt5, inline = '5.', tooltip = t31)
l5 = input.int(21, 'Length', minval = 1, group = gSt5, inline = '5.', tooltip = t31 + "\n\n" + t32)
w5 = input.float(1.6, 'Weight', minval = 0.0, step = 0.1, group = gSt5, inline = 'w5', tooltip = t33)
//}
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~}

// ~~ CONSTANTS & STYLING {
EPS = 0.0000001
N = 5
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~}

// ~~ HELPER FUNCTIONS {
fMa(t, s, l) =>
    ln = math.max(1, l)
    switch t
        'SMA'  => ta.sma(s, ln)
        'EMA'  => ta.ema(s, ln)
        'LSMA' => ta.linreg(s, ln, 0)
        'WMA'  => ta.wma(s, ln)
        'HMA'  => ta.hma(s, ln)
        'RMA'  => ta.rma(s, ln)
        => ta.sma(s, ln)

fSt(src, atrLen, fac) =>
    atr = ta.atr(math.max(1, atrLen))
    ub0 = src + fac * atr
    lb0 = src - fac * atr

    ub = ub0
    ub := na(ub[1]) ? ub0 : (ub0 < ub[1] or src[1] > ub[1] ? ub0 : ub[1])

    lb = lb0
    lb := na(lb[1]) ? lb0 : (lb0 > lb[1] or src[1] < lb[1] ? lb0 : lb[1])

    d = 1.0
    d := na(d[1]) ? 1.0 : d[1] == -1.0 and src > ub[1] ? 1.0 : d[1] == 1.0 and src < lb[1] ? -1.0 : d[1]

    st = d == 1.0 ? lb : ub
    [st, d]
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~}

// ~~ MULTI-SUPERTREND ENGINE {
src = hlc3

s1 = fMa(m1, src, l1)
s2 = fMa(m2, src, l2)
s3 = fMa(m3, src, l3)
s4 = fMa(m4, src, l4)
s5 = fMa(m5, src, l5)

[st1, d1] = fSt(s1, a1, f1)
[st2, d2] = fSt(s2, a2, f2)
[st3, d3] = fSt(s3, a3, f3)
[st4, d4] = fSt(s4, a4, f4)
[st5, d5] = fSt(s5, a5, f5)
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~}

// ~~ ARRAYS FOR STORAGE {
var array<float> wArr = array.new_float(0)
var array<float> stArr = array.new_float(0)
var array<float> dArr = array.new_float(0)

if barstate.isfirst
    array.push(wArr, w1), array.push(wArr, w2), array.push(wArr, w3), array.push(wArr, w4), array.push(wArr, w5)
    for _ = 0 to N - 1
        array.push(stArr, na)
        array.push(dArr, na)

if array.size(wArr) != N or array.size(stArr) != N or array.size(dArr) != N
    runtime.error('Array size mismatch. Expected 5 elements in all arrays.')

array.set(stArr, 0, st1), array.set(stArr, 1, st2), array.set(stArr, 2, st3), array.set(stArr, 3, st4), array.set(stArr, 4, st5)
array.set(dArr, 0, d1), array.set(dArr, 1, d2), array.set(dArr, 2, d3), array.set(dArr, 3, d4), array.set(dArr, 4, d5)
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~}

// ~~ CONSENSUS ENGINE {
var matrix<float> mDat = matrix.new<float>(N, 3, na)

if matrix.rows(mDat) != N or matrix.columns(mDat) != 3
    runtime.error('Matrix size mismatch. Expected 5x3.')

for i = 0 to N - 1
    matrix.set(mDat, i, 0, array.get(dArr, i))
    matrix.set(mDat, i, 1, array.get(wArr, i))
    matrix.set(mDat, i, 2, array.get(stArr, i))

wSum = 0.0
wBu = 0.0
wBe = 0.0
lnBuNum = 0.0
lnBeNum = 0.0

for i = 0 to N - 1
    d = matrix.get(mDat, i, 0)
    w = matrix.get(mDat, i, 1)
    st = matrix.get(mDat, i, 2)

    wSum += w

    if d > 0
        wBu += w
        lnBuNum += st * w
    else if d < 0
        wBe += w
        lnBeNum += st * w

wSum := math.max(wSum, EPS)

scBu = wBu / wSum
scBe = wBe / wSum
scCl = scBu - scBe
strCl = math.abs(scCl)

lnBu = wBu > 0 ? lnBuNum / wBu : na
lnBe = wBe > 0 ? lnBeNum / wBe : na

baseRow = math.max(0, math.min(N - 1, baseIx - 1))
stB = matrix.get(mDat, baseRow, 2)
dB  = matrix.get(mDat, baseRow, 0)

flipBu = ta.crossover(dB, 0)
flipBe = ta.crossunder(dB, 0)
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~}

// ~~ FINAL FILTERED REGIME {
isBu = scBu >= thr
isBe = scBe >= thr

okBu = isBu and dB > 0
okBe = isBe and dB < 0

var float dLast = 0.0
if okBu and not okBe
    dLast := 1.0
else if okBe and not okBu
    dLast := -1.0

lnCl = dLast > 0 ? lnBu : dLast < 0 ? lnBe : na
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~}

// ~~ VISUALIZATION {
cBar = scCl > 0 ? color.from_gradient(strCl, 0.0, 1.0, cN, cBu) : color.from_gradient(strCl, 0.0, 1.0, cN, cBe)

barcolor(useBc ? cBar : na)
plotcandle(useBc ? open : na, useBc ? high : na, useBc ? low : na, useBc ? close : na, color = useBc ? cBar : na, bordercolor = useBc ? cBar : na, wickcolor = useBc ? cBar : na)

plotshape(ta.crossover(dLast, 0), 'Major Long', shape.labelup, location.belowbar, color.new(cBu, 30), size = size.tiny, text = '▲', textcolor = color.white)
plotshape(ta.crossunder(dLast, 0), 'Major Short', shape.labeldown, location.abovebar, color.new(cBe, 30), size = size.tiny, text = '▼', textcolor = color.white)

plotshape(showDot and flipBu ? stB : na, 'Base ST Long', shape.triangleup, location.absolute, dLast > 0 ? color.new(cBu, 40) : color.new(cBe, 40), size = size.tiny)
plotshape(showDot and flipBe ? stB : na, 'Base ST Short', shape.triangledown, location.absolute, dLast > 0 ? color.new(cBu, 40) : color.new(cBe, 40), size = size.tiny)

if showLbl and flipBu
    label.new(bar_index, stB, text = 'Bull Cluster\n' + str.tostring(scBu * 100.0, '#.#') + '%', color = color.new(cBu, 90), textcolor = cBu, style = label.style_label_up, yloc = yloc.price, size = size.small)

if showLbl and flipBe
    label.new(bar_index, stB, text = 'Bear Cluster\n' + str.tostring(scBe * 100.0, '#.#') + '%', color = color.new(cBe, 90), textcolor = cBe, style = label.style_label_down, yloc = yloc.price, size = size.small)

pUp = plot(dLast == 1 ? lnCl : na, 'Cluster Up Trend', color = cBu, style = plot.style_linebr, linewidth = 2)
pDn = plot(dLast == -1 ? lnCl : na, 'Cluster Down Trend', color = cBe, style = plot.style_linebr, linewidth = 2)

// Hidden active-line plot for cloud fill
pCl = plot(lnCl, 'Active Cluster Line', color = color.new(chart.fg_color, 100), display = display.none)

// Hidden smoothed price reference for cloud fill
cloudRef = ta.sma(hlc3, cloudLen)
pRef = plot(cloudRef, 'Cloud Reference', color = color.new(chart.fg_color, 100), display = display.none)

cloudClr = showCloud ? dLast > 0 ? color.new(cCloudBu, cloudTransp) : dLast < 0 ? color.new(cCloudBe, cloudTransp) : na : na
fill(pCl, pRef, lnCl, cloudRef, cloudClr, color(na))
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~}

// ~~ ALERTS {
alBu = ta.crossover(dLast, 0)
alBe = ta.crossunder(dLast, 0)
alAny = alBu or alBe

alertcondition(alBu, 'Long', 'Bullish clustered SuperTrend signal')
alertcondition(alBe, 'Short', 'Bearish clustered SuperTrend signal')
alertcondition(alAny, 'Signal', 'Clustered SuperTrend signal')
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~}