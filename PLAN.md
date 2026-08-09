// This work is licensed under a Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0) https://creativecommons.org/licenses/by-nc-sa/4.0/
// © Zeiierman {

//@version=6
indicator('Fear & Greed Index (Zeiierman)', max_bars_back = 500, max_lines_count = 500, max_polylines_count = 100, precision = 1)
//~~}

// ~~ Vars {
b = bar_index
xy = array.new<chart.point>()
var poly = array.new<polyline>(20, na)
//~~}

// ~~ Funcs {
Scales(input) =>
    hi = ta.max(input)
    lo = ta.min(input)
    hi != lo ? (input - lo) / (hi - lo) * 100 : 50

Scale(input) =>
    hi = ta.highest(input, 100)
    lo = ta.lowest(input, 100)
    hi != lo ? (input - lo) / (hi - lo) * 100 : 50

createZone(color _zoneColor, float _startAngle, float _endAngle, int _zoneIndex) =>
    zone = array.new<chart.point>()

    zone.push(chart.point.from_index(b, 0))

    float angleStep = 0.5
    for a = _startAngle to _endAngle by angleStep
        x = b + math.round(100 * math.sin(math.toradians(a)))
        y = 100 * math.cos(math.toradians(a))
        zone.push(chart.point.from_index(x, y))

    xEnd = b + math.round(100 * math.sin(math.toradians(_endAngle)))
    yEnd = 100 * math.cos(math.toradians(_endAngle))
    zone.push(chart.point.from_index(xEnd, yEnd))
    zone.push(chart.point.from_index(b, 0))

    oldPoly = poly.get(_zoneIndex)
    if not na(oldPoly)
        oldPoly.delete()

    poly.set(_zoneIndex, polyline.new(zone, false, true, line_color = color.new(_zoneColor, 75), fill_color = color.new(_zoneColor, 50)))


// ~~ Visual {
if barstate.islast
    colors = array.from(
         color.rgb(255, 0, 0), color.rgb(233, 16, 16), color.rgb(201, 34, 34), color.rgb(197, 51, 51), color.rgb(197, 69, 69),
         color.rgb(199, 89, 89), color.rgb(227, 113, 113), color.rgb(232, 134, 134), color.rgb(232, 157, 134), color.rgb(255, 185, 80),
         color.rgb(255, 185, 80), color.rgb(144, 243, 177), color.rgb(144, 243, 177), color.rgb(117, 225, 153), color.rgb(97, 193, 129),
         color.rgb(79, 189, 116), color.rgb(49, 169, 89), color.rgb(38, 193, 89), color.rgb(21, 224, 88), color.rgb(0, 255, 85)
    )

    int zoneCount = 20
    float zoneWidth = 180.0 / zoneCount

    for i = 0 to zoneCount - 1
        startAngle = -90.0 + i * zoneWidth
        endAngle = startAngle + zoneWidth
        createZone(colors.get(i), startAngle, endAngle, i)
//~~}
// ~~ Fear & Greed {
// S&P 500 125-day moving average
[spxPrice, spxAverage] = request.security('SPX', 'D', [close, ta.sma(close, 125)])
sp125 = Scales(spxPrice - spxAverage)

// Stock price strength: 52-week high vs 52-week low
week52 = request.security('NYSE:NYA', 'W', close - math.avg(ta.highest(high, 52), ta.lowest(low, 52))) / 100
hl52 = Scales(week52)

// Stock price breadth: McClellan
adv = ta.sma(request.security('ADVN', 'D', close), 19)
dec = ta.sma(request.security('DECN', 'D', close), 19)
mcsi = Scales(ta.sma(adv - dec, 19))

// Put and call options: Put/Call 5-day average
putCallRatio = ta.sma(request.security('USI:PCC', 'D', close), 5)
putcall = Scale(-putCallRatio)

// Market volatility: VIX vs 50-day average
vix = request.security('CBOE:VIX', 'D', close)
vixMA = ta.sma(vix, 50)
vix50 = Scale(-(vix - vixMA))

// Safe haven demand: SPX vs Bonds
stockReturns = ta.sma(spxPrice - spxPrice[20], 20)
[bond, bond20] = request.security('US10Y', 'D', [close, close[20]])
safe = Scales(stockReturns - (bond - bond20))

// Junk bond demand: Yield spread
junkBondYield = request.security('AMEX:JNK', 'D', close)
treasuryYield = request.security('US10Y', 'D', close)
yieldSpread = Scale(junkBondYield - treasuryYield)
//~~}

// ~~ Arrow {
combined = math.avg(sp125, hl52, vix50, mcsi, putcall, safe, yieldSpread)
new = combined > 50 ? 200 - combined * 2 : combined * 2
loc = combined > 50 ? b + math.round(combined * 2 - 100) : b - math.round(100 - combined * 2)

l1 = line.new(b, 0, loc, new, color = chart.fg_color, width = 3, style = line.style_arrow_right)
lab1 = label.new(b, 0, '', style = label.style_circle, color = chart.fg_color, size = size.small)
lab2 = label.new(loc, new, str.tostring(math.round(combined)), style = loc > b ? label.style_label_left : label.style_label_right, color = color(na), textcolor = chart.fg_color, size = size.normal)

(l1[1]).delete()
(lab1[1]).delete()
(lab2[1]).delete()
//~~}

// ~~ Labels {
EF = label.new(b - 100, 0, 'Extreme Fear', color = color(na), textcolor = color.red, style = label.style_label_right)
EG = label.new(b + 100, 0, 'Extreme Greed', color = color(na), textcolor = color.green, style = label.style_label_left)
F = label.new(b - 65, 85, 'Fear', color = color(na), textcolor = color.red, style = label.style_label_right)
G = label.new(b + 65, 85, 'Greed', color = color(na), textcolor = color.green, style = label.style_label_left)
N = label.new(b, 100, 'Neutral', color = color(na), textcolor = chart.fg_color)

(EF[1]).delete()
(EG[1]).delete()
(F[1]).delete()
(G[1]).delete()
(N[1]).delete()
//~~}