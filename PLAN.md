
// This work is licensed under Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
// https://creativecommons.org/licenses/by-nc-sa/4.0/
// © Zeiierman {
//@version=6
indicator("Doji Volume Map (Zeiierman)", overlay = true, max_lines_count = 500, max_labels_count = 500, max_boxes_count = 500)
//}

// ~~ Tooltips {
var string t1  = "How many bars back the script scans to find qualifying candles. Higher values show more historical signals but use more chart resources."
var string t2  = "Length of the average volume calculation used as the baseline for relative volume. Larger values smooth the benchmark more."
var string t3  = "Minimum multiple of average volume required for a candle to qualify. Example: 1.5 means current volume must be at least 1.5x the average volume."
var string t4  = "Maximum candle body size allowed, expressed as a percentage of the full candle range. Lower values require a more doji-like candle."
var string t5  = "Minimum candle range required, measured as a fraction of ATR. Helps ignore very small candles that look like dojis but have little significance."

var string t6  = "Show or hide the bubble markers on qualifying candles."
var string t7  = "Show or hide projected horizontal levels from qualifying bubbles."
var string t8  = "Maximum number of projected levels or merged zones to display from the current lookback window."
var string t9  = "Use bullish and bearish colors based on candle direction. When disabled, all bubbles and levels use the neutral color."
var string t10 = "Color used for bullish qualifying candles when Bull/Bear Bubble Color is enabled."
var string t11 = "Color used for bearish qualifying candles when Bull/Bear Bubble Color is enabled."
var string t12 = "Fallback color used when Bull/Bear Bubble Color is disabled."

var string t13 = "When enabled, projected levels that are close together are combined into a single zone box instead of being shown as separate lines."
var string t14 = "Maximum distance between levels, measured in ATR units, for them to be merged into the same zone."
var string t15 = "Transparency of merged zone boxes. Higher values make the box more transparent."
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~}

// ~~ Inputs {
string SIGNAL_GROUP = "Signal Logic"
string STYLE_GROUP  = "Bubble Style"
string MERGE_GROUP  = "Level Merging"

lookbackInput       = input.int(200, "Lookback Length", minval = 20, maxval = 5000, group = SIGNAL_GROUP, tooltip = t1)
volLengthInput      = input.int(20, "Volume Average Length", minval = 1, group = SIGNAL_GROUP, tooltip = t2)
relVolMultInput     = input.float(1.3, "Relative Volume Multiplier", minval = 0.1, step = 0.1, group = SIGNAL_GROUP, tooltip = t3)
bodyPctInput        = input.float(25.0, "Max Body % of Range", minval = 1, maxval = 100, step = 1, group = SIGNAL_GROUP, tooltip = t4)
minRangeAtrFrac     = input.float(0.20, "Min Candle Range as ATR Fraction", minval = 0.0, step = 0.05, group = SIGNAL_GROUP, tooltip = t5)

showBubblesInput    = input.bool(true, "Show Bubbles", inline = "show", group = STYLE_GROUP, tooltip = t6)
projectLevelsInput  = input.bool(true, "Project Levels", inline = "show", group = STYLE_GROUP, tooltip = t7)
levelsQtyInput      = input.int(8, "Max Projected Levels", minval = 1, maxval = 100, inline = "p", group = STYLE_GROUP, tooltip = t8)
bullBearColorInput  = input.bool(true, "Bull/Bear Bubble Color", group = STYLE_GROUP, tooltip = t9)
BULL_COLOR          = input.color(#089981, "", inline = "color", group = STYLE_GROUP, tooltip = t10)
BEAR_COLOR          = input.color(#f23645, "", inline = "color", group = STYLE_GROUP, tooltip = t11)
NEUTRAL_COLOR       = input.color(#787b86, "", inline = "color", group = STYLE_GROUP, tooltip = t12)

mergeCloseLevels    = input.bool(true, "Merge Close Levels Into Box", group = MERGE_GROUP, tooltip = t13)
mergeDistanceAtr    = input.float(0.25, "Merge Distance (ATR)", minval = 0.01, step = 0.01, group = MERGE_GROUP, tooltip = t14)
boxTransparency     = input.int(85, "Box Transparency", minval = 0, maxval = 100, group = MERGE_GROUP, tooltip = t15)
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~}

// ~~ Storage {
var label[] bubbleLabels   = array.new<label>()
var line[] projectedLines  = array.new<line>()
var label[] levelLabels    = array.new<label>()
var box[] mergedLevelBoxes = array.new<box>()
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~}

// ~~ Series calculations {
bodySize    = math.abs(close - open)
candleRange = high - low
bodyPct     = candleRange > 0 ? (bodySize / candleRange) * 100.0 : 100.0

volAvg      = ta.sma(volume, volLengthInput)
volStd      = ta.stdev(volume, volLengthInput)
volZ        = volStd != 0 ? (volume - volAvg) / volStd : 0.0

atrVal      = ta.atr(14)
minRangeOk  = candleRange >= atrVal * minRangeAtrFrac

relHighVol  = volume > volAvg * relVolMultInput
volRising   = volume > volume[1]
looseDoji   = candleRange > 0 and bodyPct <= bodyPctInput and minRangeOk

signal      = relHighVol and volRising and looseDoji
signalPrice = hl2
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~}

// ~~ Buffer assignment {
srcSignal = signal
srcPrice  = signalPrice
srcZ      = volZ
srcCl     = close
srcOp     = open
srcVol    = volume
srcHi     = high
srcLo     = low

max_bars_back(srcSignal, 5000)
max_bars_back(srcPrice, 5000)
max_bars_back(srcZ, 5000)
max_bars_back(srcCl, 5000)
max_bars_back(srcOp, 5000)
max_bars_back(srcVol, 5000)
max_bars_back(srcHi, 5000)
max_bars_back(srcLo, 5000)
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~}

// ~~ Helpers {
get_bubble_size(float z) =>
    string sz = size.tiny
    if z > 5.0
        sz := size.huge
    else if z > 3.5
        sz := size.large
    else if z > 2.5
        sz := size.normal
    else if z > 1.8
        sz := size.small
    sz

get_tier_text(float z) =>
    if z > 5.0
        "Low"
    else if z > 3.0
        "Medium"
    else
        "High"

get_zone_text(float maxZ) =>
    if maxZ > 5.0
        "Low"
    else if maxZ > 3.0
        "Medium"
    else
        "High"
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~}

// ~~ Rendering {
if barstate.islast
    if array.size(bubbleLabels) > 0
        for l in bubbleLabels
            label.delete(l)
        array.clear(bubbleLabels)

    if array.size(projectedLines) > 0
        for ln in projectedLines
            line.delete(ln)
        array.clear(projectedLines)

    if array.size(levelLabels) > 0
        for lb in levelLabels
            label.delete(lb)
        array.clear(levelLabels)

    if array.size(mergedLevelBoxes) > 0
        for bx in mergedLevelBoxes
            box.delete(bx)
        array.clear(mergedLevelBoxes)

    if showBubblesInput
        int labelX = bar_index + 35 + 0
        float mergeThreshold = atrVal * mergeDistanceAtr

        float[] zoneTopArr   = array.new<float>()
        float[] zoneBotArr   = array.new<float>()
        float[] zoneMidArr   = array.new<float>()
        float[] zoneMaxZArr  = array.new<float>()
        float[] zoneDirArr   = array.new<float>()
        int[]   zoneCountArr = array.new<int>()
        int[]   zoneStartArr = array.new<int>()

        int levelsCount = 0

        for i = 0 to lookbackInput - 1
            if srcSignal[i]
                color bubbleColor = bullBearColorInput
                     ? (srcCl[i] >= srcOp[i] ? color.new(BULL_COLOR, 35) : color.new(BEAR_COLOR, 35))
                     : color.new(NEUTRAL_COLOR, 35)

                string bubbleSize = get_bubble_size(srcZ[i])

                label bubble = label.new(
                     x = bar_index - i,
                     y = srcPrice[i],
                     text = "",
                     style = label.style_circle,
                     color = bubbleColor,
                     size = bubbleSize,
                     tooltip =
                         "Relative High Volume + Rising Volume + Loose Doji" +
                         "\nZ-Score: " + str.tostring(srcZ[i], "#.##") +
                         "\nVolume: " + str.tostring(srcVol[i], format.volume) +
                         "\nBody %: " + str.tostring(
                             (srcHi[i] - srcLo[i]) > 0 ? (math.abs(srcCl[i] - srcOp[i]) / (srcHi[i] - srcLo[i])) * 100.0 : 0.0,
                             "#.##"
                         )
                )
                array.push(bubbleLabels, bubble)

                if projectLevelsInput and levelsCount < levelsQtyInput
                    if mergeCloseLevels
                        bool merged = false
                        int zoneSize = array.size(zoneMidArr)

                        if zoneSize > 0
                            for z = 0 to zoneSize - 1
                                float zoneMid = array.get(zoneMidArr, z)
                                if math.abs(srcPrice[i] - zoneMid) <= mergeThreshold
                                    float oldTop   = array.get(zoneTopArr, z)
                                    float oldBot   = array.get(zoneBotArr, z)
                                    float oldMaxZ  = array.get(zoneMaxZArr, z)
                                    float oldDir   = array.get(zoneDirArr, z)
                                    int oldCount   = array.get(zoneCountArr, z)
                                    int oldStart   = array.get(zoneStartArr, z)

                                    float newTop   = math.max(oldTop, srcPrice[i])
                                    float newBot   = math.min(oldBot, srcPrice[i])
                                    float newMid   = (newTop + newBot) / 2.0
                                    float newMaxZ  = math.max(oldMaxZ, srcZ[i])
                                    float thisDir  = srcCl[i] >= srcOp[i] ? 1.0 : -1.0
                                    float newDir   = oldDir + thisDir
                                    int newCount   = oldCount + 1
                                    int newStart   = math.min(oldStart, bar_index - i)

                                    array.set(zoneTopArr, z, newTop)
                                    array.set(zoneBotArr, z, newBot)
                                    array.set(zoneMidArr, z, newMid)
                                    array.set(zoneMaxZArr, z, newMaxZ)
                                    array.set(zoneDirArr, z, newDir)
                                    array.set(zoneCountArr, z, newCount)
                                    array.set(zoneStartArr, z, newStart)

                                    merged := true
                                    break

                        if not merged
                            array.push(zoneTopArr, srcPrice[i])
                            array.push(zoneBotArr, srcPrice[i])
                            array.push(zoneMidArr, srcPrice[i])
                            array.push(zoneMaxZArr, srcZ[i])
                            array.push(zoneDirArr, srcCl[i] >= srcOp[i] ? 1.0 : -1.0)
                            array.push(zoneCountArr, 1)
                            array.push(zoneStartArr, bar_index - i)

                        levelsCount += 1
                    else
                        line lvl = line.new(
                             x1 = bar_index - i,
                             y1 = srcPrice[i],
                             x2 = labelX,
                             y2 = srcPrice[i],
                             color = bubbleColor,
                             style = line.style_dashed,
                             width = 1,
                             extend = extend.none
                        )
                        array.push(projectedLines, lvl)

                        label tier = label.new(
                             x = labelX,
                             y = srcPrice[i],
                             text = get_tier_text(srcZ[i]),
                             style = label.style_label_left,
                             textcolor = bubbleColor,
                             color = color.new(chart.bg_color, 100),
                             size = size.small
                        )
                        array.push(levelLabels, tier)

                        levelsCount += 1

        if projectLevelsInput and mergeCloseLevels
            int zoneSize = array.size(zoneMidArr)

            if zoneSize > 0
                for z = 0 to zoneSize - 1
                    float zoneTop   = array.get(zoneTopArr, z)
                    float zoneBot   = array.get(zoneBotArr, z)
                    float zoneMid   = array.get(zoneMidArr, z)
                    float zoneMaxZ  = array.get(zoneMaxZArr, z)
                    float zoneDir   = array.get(zoneDirArr, z)
                    int zoneCount   = array.get(zoneCountArr, z)
                    int zoneStart   = array.get(zoneStartArr, z)

                    color zoneBaseColor = bullBearColorInput
                         ? (zoneDir >= 0 ? BULL_COLOR : BEAR_COLOR)
                         : NEUTRAL_COLOR

                    if zoneCount > 1
                        float pad = math.max(syminfo.mintick * 2.0, mergeThreshold * 0.35)

                        box zoneBox = box.new(
                             left = math.max(zoneStart, bar_index - lookbackInput),
                             top = zoneTop + pad,
                             right = labelX,
                             bottom = zoneBot - pad,
                             border_color = color.new(zoneBaseColor, 15),
                             border_width = 1,
                             bgcolor = color.new(zoneBaseColor, boxTransparency)
                        )
                        array.push(mergedLevelBoxes, zoneBox)

                        label zoneLbl = label.new(
                             x = labelX,
                             y = zoneMid,
                             text = get_zone_text(zoneMaxZ),
                             style = label.style_label_left,
                             textcolor = zoneBaseColor,
                             color = color.new(chart.bg_color, 100),
                             size = size.small
                        )
                        array.push(levelLabels, zoneLbl)
                    else
                        line lvl = line.new(
                             x1 = zoneStart,
                             y1 = zoneMid,
                             x2 = labelX,
                             y2 = zoneMid,
                             color = color.new(zoneBaseColor, 0),
                             style = line.style_dashed,
                             width = 1,
                             extend = extend.none
                        )
                        array.push(projectedLines, lvl)

                        label tier = label.new(
                             x = labelX,
                             y = zoneMid,
                             text = get_zone_text(zoneMaxZ),
                             style = label.style_label_left,
                             textcolor = zoneBaseColor,
                             color = color.new(chart.bg_color, 100),
                             size = size.small
                        )
                        array.push(levelLabels, tier)
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~}                        
