import SwiftUI

// The reader's Start over and Loop text icons (src/ui/reader/PlayerIcons.tsx), drawn again for the
// Live Activity, which can't use the app's SVGs. Same 24-unit grid and the same strokes, so the banner's
// buttons look like the ones in the player bar. Keep the two in step when either changes.

/// The 24-unit grid scaled to the frame it's given.
private func grid(_ rect: CGRect) -> CGAffineTransform {
    CGAffineTransform(scaleX: rect.width / 24, y: rect.height / 24)
}

/// Two arrows chasing each other around a box (PlayerIcons' FRAME).
private struct LoopFrame: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: 3, y: 10))
        p.addArc(tangent1End: CGPoint(x: 3, y: 5), tangent2End: CGPoint(x: 6.5, y: 5), radius: 3.5)
        p.addLine(to: CGPoint(x: 20, y: 5))
        p.move(to: CGPoint(x: 17.5, y: 2.5))
        p.addLine(to: CGPoint(x: 20, y: 5))
        p.addLine(to: CGPoint(x: 17.5, y: 7.5))
        p.move(to: CGPoint(x: 21, y: 14))
        p.addArc(tangent1End: CGPoint(x: 21, y: 19), tangent2End: CGPoint(x: 4, y: 19), radius: 3.5)
        p.addLine(to: CGPoint(x: 4, y: 19))
        p.move(to: CGPoint(x: 6.5, y: 21.5))
        p.addLine(to: CGPoint(x: 4, y: 19))
        p.addLine(to: CGPoint(x: 6.5, y: 16.5))
        return p.applying(grid(rect))
    }
}

/// The block of three lines inside the loop: the whole text.
private struct LoopLines: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        for (y, end) in [(9.8, 15.5), (12, 15.5), (14.2, 13)] {
            p.move(to: CGPoint(x: 8.5, y: y))
            p.addLine(to: CGPoint(x: end, y: y))
        }
        return p.applying(grid(rect))
    }
}

/// The counterclockwise arrow: a circle of radius 9 about the middle, open at the top left.
private struct StartOverArrow: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: 1.5, y: 4))
        p.addLine(to: CGPoint(x: 1.5, y: 10))
        p.addLine(to: CGPoint(x: 7.5, y: 10))
        // From the lower left, down and around the right to the upper left (the SVG's `a9 9 0 102.1-9.3`).
        let center = CGPoint(x: 12, y: 12)
        let start = Angle(degrees: 160.56)
        p.move(to: CGPoint(x: center.x + 9 * cos(start.radians), y: center.y + 9 * sin(start.radians)))
        p.addRelativeArc(center: center, radius: 9, startAngle: start, delta: Angle(degrees: -296.01))
        p.addLine(to: CGPoint(x: 1.5, y: 10))
        return p.applying(grid(rect))
    }
}

/// The play triangle inside the arrow.
private struct StartOverTriangle: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: 10, y: 8.8))
        p.addLine(to: CGPoint(x: 10, y: 15.2))
        p.addLine(to: CGPoint(x: 15.2, y: 12))
        p.closeSubpath()
        return p.applying(grid(rect))
    }
}

/// Loop text's icon, in the current foreground style.
struct LoopIcon: View {
    var size: CGFloat
    var body: some View {
        let s = size / 24
        ZStack {
            LoopFrame().stroke(style: StrokeStyle(lineWidth: 2 * s, lineCap: .round, lineJoin: .round))
            LoopLines().stroke(style: StrokeStyle(lineWidth: 1.5 * s, lineCap: .round))
        }
        .frame(width: size, height: size)
    }
}

/// Start over's icon, in the current foreground style.
struct StartOverIcon: View {
    var size: CGFloat
    var body: some View {
        let s = size / 24
        ZStack {
            StartOverArrow().stroke(style: StrokeStyle(lineWidth: 2.2 * s, lineCap: .round, lineJoin: .round))
            StartOverTriangle().fill()
            StartOverTriangle().stroke(style: StrokeStyle(lineWidth: 1.2 * s, lineJoin: .round))
        }
        .frame(width: size, height: size)
    }
}
