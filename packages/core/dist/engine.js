function segmentLength(line) {
    const dx = line.x2 - line.x1;
    const dy = line.y2 - line.y1;
    return Math.hypot(dx, dy);
}
function lineMidpoint(line) {
    return { x: (line.x1 + line.x2) * 0.5, y: (line.y1 + line.y2) * 0.5 };
}
function lineDirection(line) {
    return { dx: line.x2 - line.x1, dy: line.y2 - line.y1 };
}
function averageMidpoint(lines) {
    if (lines.length === 0)
        return { x: 0.5, y: 0.5 };
    let sx = 0;
    let sy = 0;
    for (const line of lines) {
        const mid = lineMidpoint(line);
        sx += mid.x;
        sy += mid.y;
    }
    return { x: sx / lines.length, y: sy / lines.length };
}
function estimateAnchorPoint(lines) {
    if (lines.length === 0)
        return { x: 0.5, y: 0.5 };
    const horizontal = lines
        .filter((line) => {
        const { dx, dy } = lineDirection(line);
        return Math.abs(dx) > Math.abs(dy) * 1.5;
    })
        .sort((a, b) => (segmentLength(b) * b.score) - (segmentLength(a) * a.score));
    const vertical = lines
        .filter((line) => {
        const { dx, dy } = lineDirection(line);
        return Math.abs(dy) > Math.abs(dx) * 1.5;
    })
        .sort((a, b) => (segmentLength(b) * b.score) - (segmentLength(a) * a.score));
    if (horizontal.length > 0 && vertical.length > 0) {
        const hMid = lineMidpoint(horizontal[0]);
        const vMid = lineMidpoint(vertical[0]);
        return { x: vMid.x, y: hMid.y };
    }
    if (horizontal.length > 0)
        return lineMidpoint(horizontal[0]);
    if (vertical.length > 0)
        return lineMidpoint(vertical[0]);
    return averageMidpoint(lines);
}
function selectStrongLines(frame) {
    return [...frame.lines]
        .filter((line) => Number.isFinite(line.score) && line.score > 0.2)
        .sort((a, b) => (segmentLength(b) * b.score) - (segmentLength(a) * a.score))
        .slice(0, 24);
}
function normalizePoint(point, frame) {
    const w = frame.frameSize?.width ?? 1;
    const h = frame.frameSize?.height ?? 1;
    return {
        x: w > 1 ? point.x / w : point.x,
        y: h > 1 ? point.y / h : point.y,
    };
}
function estimateConfidence(lines, previous) {
    const scoreMean = lines.length > 0
        ? lines.reduce((acc, line) => acc + line.score, 0) / lines.length
        : 0;
    const countBoost = Math.min(lines.length / 12, 1);
    const temporalBoost = previous ? 0.08 : 0;
    return Math.max(0, Math.min(1, (scoreMean * 0.65) + (countBoost * 0.27) + temporalBoost));
}
function lineAngle(line) {
    return Math.atan2(line.y2 - line.y1, line.x2 - line.x1);
}
function normalizeAngleRad(angle) {
    const pi = Math.PI;
    let a = angle;
    while (a <= -pi)
        a += 2 * pi;
    while (a > pi)
        a -= 2 * pi;
    return a;
}
function undirectedAngleDelta(a, b) {
    const direct = Math.abs(normalizeAngleRad(a - b));
    const flipped = Math.abs(normalizeAngleRad(a - b + Math.PI));
    return Math.min(direct, flipped);
}
function templateEdgeAngle(edge) {
    return Math.atan2(edge.b[1] - edge.a[1], edge.b[0] - edge.a[0]);
}
function templateEdgeWeight(edge) {
    const weight = edge.weight ?? 1;
    return Number.isFinite(weight) && weight > 0 ? weight : 1;
}
function bestObservedSimilarity(observedAngles, templateAngle, yaw) {
    if (observedAngles.length === 0)
        return 0;
    let best = 0;
    for (const observed of observedAngles) {
        const d = undirectedAngleDelta(observed, templateAngle + yaw);
        const sim = Math.max(0, 1 - (d / (Math.PI / 2)));
        if (sim > best)
            best = sim;
    }
    return best;
}
function estimateYawFromTemplate(lines, edges) {
    const observedAngles = lines.map((line) => lineAngle(line));
    const template = edges.map((edge) => ({
        angle: templateEdgeAngle(edge),
        weight: templateEdgeWeight(edge),
        tag: edge.tag,
    }));
    const totalWeight = template.reduce((acc, edge) => acc + edge.weight, 0);
    let bestYaw = 0;
    let bestScore = 0;
    let bestCoverage = 0;
    let bestTags = new Set();
    for (let deg = -90; deg <= 90; deg += 5) {
        const yaw = (deg * Math.PI) / 180;
        let weightedSimilarity = 0;
        let coveredWeight = 0;
        const tags = new Set();
        for (const t of template) {
            const sim = bestObservedSimilarity(observedAngles, t.angle, yaw);
            weightedSimilarity += sim * t.weight;
            if (sim >= 0.6) {
                coveredWeight += t.weight;
                if (t.tag)
                    tags.add(t.tag);
            }
        }
        const score = totalWeight > 0 ? weightedSimilarity / totalWeight : 0;
        const coverage = totalWeight > 0 ? coveredWeight / totalWeight : 0;
        if (score > bestScore) {
            bestScore = score;
            bestYaw = yaw;
            bestCoverage = coverage;
            bestTags = tags;
        }
    }
    return {
        yaw: bestYaw,
        orientationScore: bestScore,
        weightedCoverage: bestCoverage,
        matchedTags: bestTags,
    };
}
function requiredTagFactor(requiredTags, matchedTags) {
    if (!requiredTags || requiredTags.length === 0)
        return 1;
    const normalized = requiredTags.filter((tag) => tag.trim().length > 0);
    if (normalized.length === 0)
        return 1;
    let matched = 0;
    for (const tag of normalized) {
        if (matchedTags.has(tag))
            matched += 1;
    }
    const ratio = matched / normalized.length;
    // Enforce a meaningful penalty when required tagged edges are missing.
    return Math.max(0.2, ratio);
}
function smoothPoint(current, previous) {
    if (!previous)
        return current;
    const alpha = 0.7;
    return {
        x: (current.x * alpha) + (previous.imagePoint.x * (1 - alpha)),
        y: (current.y * alpha) + (previous.imagePoint.y * (1 - alpha)),
    };
}
function makeDetection(options, lines, frame, previous) {
    if (options.shapeModel.type !== "edge-graph" || !options.shapeModel.edges?.length)
        return null;
    if (lines.length === 0)
        return null;
    const midpoint = estimateAnchorPoint(lines);
    const normalized = normalizePoint(midpoint, frame);
    const imagePoint = smoothPoint(normalized, previous);
    const baseConfidence = estimateConfidence(lines, previous);
    const { yaw, orientationScore, weightedCoverage, matchedTags } = estimateYawFromTemplate(lines, options.shapeModel.edges);
    const lineCoverage = Math.min(lines.length / Math.max(options.shapeModel.edges.length, 1), 1);
    const templateCoverage = (weightedCoverage * 0.7) + (lineCoverage * 0.3);
    const tagFactor = requiredTagFactor(options.shapeModel.requiredTags, matchedTags);
    const confidenceRaw = Math.max(0, Math.min(1, (baseConfidence * 0.5) + (orientationScore * 0.35) + (templateCoverage * 0.15)));
    const confidence = Math.max(0, Math.min(1, confidenceRaw * tagFactor));
    const halfYaw = yaw * 0.5;
    const sinHalf = Math.sin(halfYaw);
    const cosHalf = Math.cos(halfYaw);
    return {
        shapeId: options.shapeModel.id,
        confidence,
        imagePoint,
        pose: {
            translation: [imagePoint.x - 0.5, 0.5 - imagePoint.y, 1.25],
            rotation: [0, 0, sinHalf, cosHalf],
        },
    };
}
export function estimatePose(input) {
    const strongLines = selectStrongLines(input.frame);
    const detection = makeDetection(input.options, strongLines, input.frame, input.previous);
    return detection ? [detection] : [];
}
//# sourceMappingURL=engine.js.map