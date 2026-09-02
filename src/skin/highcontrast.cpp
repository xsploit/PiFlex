#include "skin/highcontrast.h"

#include <QBuffer>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QImage>
#include <QRegularExpression>
#include <QtDebug>
#include <algorithm>

#include "control/controlobject.h"
#include "moc_highcontrast.cpp"

namespace {
const QString kGroup = QStringLiteral("[BiteDJ]");
const QString kItem = QStringLiteral("high_contrast");
const QString kThemeItem = QStringLiteral("visual_theme");
const QString kLegacyThemeItem = QStringLiteral("main_view_style");
constexpr double kDefault = 0.0;
constexpr int kDefaultTheme = 0;

// Sub-directory of the settings dir holding the inverted copies of the skin's
// SVG icons. Regenerated on every skin parse in the mode, so editing an icon in
// the skin does not leave a stale inverted copy behind.
const QString kIconCacheDirName = QStringLiteral("high-contrast-icons");

// Comment marker in a stylesheet that exempts the rule block after it from
// inversion. See HighContrast::invertStyleSheet().
const QString kNoInvertMarker = QStringLiteral("no-invert");

bool isIdentChar(QChar c) {
    return c.isLetterOrNumber() || c == QLatin1Char('-') || c == QLatin1Char('_');
}

bool isHexDigit(QChar c) {
    return (c >= QLatin1Char('0') && c <= QLatin1Char('9')) ||
            (c >= QLatin1Char('a') && c <= QLatin1Char('f')) ||
            (c >= QLatin1Char('A') && c <= QLatin1Char('F'));
}

// Colors that are only meaningful as themselves; inverting them would either
// change nothing useful or produce a needlessly noisy literal.
bool isPassThroughName(const QString& name) {
    return name.compare(QLatin1String("transparent"), Qt::CaseInsensitive) == 0 ||
            name.compare(QLatin1String("none"), Qt::CaseInsensitive) == 0;
}

QColor withPreservedAlpha(const QColor& source, const char* replacement) {
    QColor result(QString::fromLatin1(replacement));
    result.setAlpha(source.alpha());
    return result;
}

/// Parses `#rgb` / `#rrggbb` at `pos` (which points at the '#'). Returns the
/// literal's length, or 0 when it is not a color we understand (e.g. the
/// `url(#gradient)` fragment references SVGs use).
int hexColorLength(const QString& text, int pos) {
    int digits = 0;
    while (pos + 1 + digits < text.size() && isHexDigit(text.at(pos + 1 + digits))) {
        ++digits;
    }
    // Anything longer is not a QSS color; anything else (4, 5, 7...) is a typo
    // or an identifier fragment, and is safer left alone.
    if (digits != 3 && digits != 6) {
        return 0;
    }
    // A run that continues into a non-hex identifier character (`#fffg`) is an
    // identifier, not a color.
    const int end = pos + 1 + digits;
    if (end < text.size() && isIdentChar(text.at(end))) {
        return 0;
    }
    return 1 + digits;
}

/// Inverts a decoded raster image in place, preserving alpha.
void invertImage(QImage* pImage) {
    // Straight alpha, so the inversion is not applied to channels that have
    // already been scaled by alpha (which haloes antialiased edges).
    if (pImage->format() != QImage::Format_ARGB32) {
        *pImage = pImage->convertToFormat(QImage::Format_ARGB32);
    }
    for (int y = 0; y < pImage->height(); ++y) {
        QRgb* pLine = reinterpret_cast<QRgb*>(pImage->scanLine(y));
        if (pLine == nullptr) {
            continue;
        }
        for (int x = 0; x < pImage->width(); ++x) {
            pLine[x] = HighContrast::invertColor(QColor::fromRgba(pLine[x])).rgba();
        }
    }
}

/// Inverts the raster images an SVG carries inline as `data:image/…;base64,…`.
/// Some of the skin's "SVG" icons are a PNG in an `<image>` wrapper rather than
/// real vector art — the quantize Q is one — so their colour lives in the
/// payload where no hex literal can reach it, and without this they keep their
/// night-mode white on a daylight-mode panel.
QString invertSvgDataUris(const QString& svg) {
    static const QRegularExpression dataUriRe(
            QStringLiteral(R"((data:image/[a-zA-Z]+;base64,)([A-Za-z0-9+/=\s]+))"));
    QString out;
    out.reserve(svg.size());
    int last = 0;
    QRegularExpressionMatchIterator it = dataUriRe.globalMatch(svg);
    while (it.hasNext()) {
        const QRegularExpressionMatch match = it.next();
        out.append(svg.mid(last, match.capturedStart() - last));
        last = match.capturedEnd();

        const QByteArray payload = QByteArray::fromBase64(match.captured(2).toLatin1());
        QImage image;
        if (payload.isEmpty() || !image.loadFromData(payload)) {
            // Not something we can decode — leave the icon exactly as it was
            // rather than emitting a broken data URI.
            out.append(match.captured(0));
            continue;
        }
        invertImage(&image);
        QByteArray encoded;
        QBuffer buffer(&encoded);
        buffer.open(QIODevice::WriteOnly);
        if (!image.save(&buffer, "PNG")) {
            out.append(match.captured(0));
            continue;
        }
        // Always re-emitted as PNG: it is lossless and carries the alpha these
        // icons are cut out with, whatever the source format was.
        out.append(QStringLiteral("data:image/png;base64,"));
        out.append(QString::fromLatin1(encoded.toBase64()));
    }
    out.append(svg.mid(last));
    return out;
}

/// Inverts every `#rgb`/`#rrggbb` literal in an SVG source. Restricted to
/// literals that start a value (preceded by a quote, `=`, `:`, `;` or space) so
/// `url(#someGradient)` references are left alone.
QString invertSvgSource(const QString& svg) {
    static const QRegularExpression hexRe(
            QStringLiteral(R"(([\s"'=:;])#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F]))"));
    QString out;
    out.reserve(svg.size());
    int last = 0;
    QRegularExpressionMatchIterator it = hexRe.globalMatch(svg);
    while (it.hasNext()) {
        const QRegularExpressionMatch match = it.next();
        out.append(svg.mid(last, match.capturedStart() - last));
        out.append(match.captured(1));
        const QColor color(QLatin1Char('#') + match.captured(2));
        out.append(color.isValid()
                        ? HighContrast::invertColor(color).name(QColor::HexRgb)
                        : QLatin1Char('#') + match.captured(2));
        last = match.capturedEnd();
    }
    out.append(svg.mid(last));
    return out;
}

/// Writes an inverted copy of an SVG icon into iconCacheDir and returns its
/// path. Empty when the icon cannot be read or is not an SVG, in which case the
/// caller keeps the original url. Raster icons are left alone: the skin only
/// references SVGs from its stylesheet, and the ones it does reference are flat
/// monochrome glyphs that would vanish against an inverted background.
QString invertedIconPath(const QString& url, const QString& iconCacheDir) {
    if (iconCacheDir.isEmpty() || !url.endsWith(QLatin1String(".svg"), Qt::CaseInsensitive)) {
        return QString();
    }
    // Reads through Qt's "skin:" search path as well as an absolute path, so
    // this works whether or not the sheet went through stylesheetAbsIconPaths().
    QFile in(url);
    if (!in.open(QIODevice::ReadOnly)) {
        return QString();
    }
    const QString inverted =
            invertSvgDataUris(invertSvgSource(QString::fromUtf8(in.readAll())));
    in.close();

    if (!QDir().mkpath(iconCacheDir)) {
        qWarning() << "HighContrast: cannot create icon cache" << iconCacheDir;
        return QString();
    }
    const QString outPath = iconCacheDir + QLatin1Char('/') + QFileInfo(url).fileName();
    QFile out(outPath);
    if (!out.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
        qWarning() << "HighContrast: cannot write inverted icon" << outPath;
        return QString();
    }
    out.write(inverted.toUtf8());
    return outPath;
}

/// Consumes a parenthesised argument list starting at the '(' in `text` and
/// returns its length including both parentheses, or 0 if it is unterminated.
int parenLength(const QString& text, int pos) {
    int depth = 0;
    for (int i = pos; i < text.size(); ++i) {
        const QChar c = text.at(i);
        if (c == QLatin1Char('(')) {
            ++depth;
        } else if (c == QLatin1Char(')')) {
            if (--depth == 0) {
                return i - pos + 1;
            }
        }
    }
    return 0;
}

/// Inverts an `rgb(...)` / `rgba(...)` literal. The alpha token is re-emitted
/// verbatim rather than re-serialized: Qt's stylesheet parser accepts alpha
/// both as 0-255 and as a 0.0-1.0 fraction, and only the sheet's author knows
/// which one was meant.
QString invertRgbFunction(const QString& name, const QString& args) {
    const QStringList parts = args.split(QLatin1Char(','));
    if (parts.size() < 3 || parts.size() > 4) {
        return QString();
    }
    int rgb[3];
    for (int i = 0; i < 3; ++i) {
        bool ok = false;
        rgb[i] = parts.at(i).trimmed().toInt(&ok);
        if (!ok || rgb[i] < 0 || rgb[i] > 255) {
            return QString();
        }
    }
    const QColor inverted = HighContrast::invertColor(QColor(rgb[0], rgb[1], rgb[2]));
    if (parts.size() == 3) {
        return QStringLiteral("%1(%2, %3, %4)")
                .arg(name)
                .arg(inverted.red())
                .arg(inverted.green())
                .arg(inverted.blue());
    }
    return QStringLiteral("%1(%2, %3, %4,%5)")
            .arg(name)
            .arg(inverted.red())
            .arg(inverted.green())
            .arg(inverted.blue())
            .arg(parts.at(3));
}
} // namespace

QAtomicPointer<HighContrast> HighContrast::s_pInstance = nullptr;

HighContrast::HighContrast(UserSettingsPointer pConfig)
        : m_pConfig(pConfig),
          m_enabled(false),
          m_theme(kDefaultTheme) {
    // Created here rather than in SystemSettings (which owns the rest of the
    // [BiteDJ] preferences) because the skin parser has to be able to consult
    // this object while it builds widgets, and CoreServices constructs it
    // before the skin is parsed. Seeded from the persisted value and written
    // back on change, same pattern as [BiteDJ],vinyl_mode.
    const ConfigKey key(kGroup, kItem);
    m_enabled = m_pConfig->getValue(key, kDefault) != 0.0;
    m_pCoEnabled = std::make_unique<ControlObject>(key);
    m_pCoEnabled->set(m_enabled ? 1.0 : 0.0);
    connect(m_pCoEnabled.get(),
            &ControlObject::valueChanged,
            this,
            &HighContrast::onEnabledChanged);

    const ConfigKey themeKey(kGroup, kThemeItem);
    // Older PiFlex builds used main_view_style for both geometry and colour.
    // Preserve that colour choice once, while allowing the two controls to be
    // changed independently from now on.
    const int legacyTheme = m_pConfig->getValue(
            ConfigKey(kGroup, kLegacyThemeItem), kDefaultTheme);
    m_theme = std::clamp(m_pConfig->getValue(themeKey, legacyTheme), 0, 2);
    m_pCoTheme = std::make_unique<ControlObject>(
            themeKey, true, false, true, kDefaultTheme);
    m_pCoTheme->set(m_theme);
    connect(m_pCoTheme.get(),
            &ControlObject::valueChanged,
            this,
            &HighContrast::onThemeChanged);

    s_pInstance.storeRelease(this);
}

HighContrast::~HighContrast() {
    s_pInstance.storeRelease(nullptr);
}

// static
HighContrast* HighContrast::tryInstance() {
    return s_pInstance.loadAcquire();
}

// static
bool HighContrast::isEnabled() {
    HighContrast* pInstance = tryInstance();
    return pInstance && pInstance->m_enabled;
}

// static
bool HighContrast::isActive() {
    HighContrast* pInstance = tryInstance();
    return pInstance && (pInstance->m_enabled || pInstance->m_theme != kDefaultTheme);
}

// static
QColor HighContrast::mapColor(const QColor& color) {
    HighContrast* pInstance = tryInstance();
    if (!pInstance) {
        return color;
    }
    const QColor themed = themeColor(color, pInstance->m_theme);
    return pInstance->m_enabled ? invertColor(themed) : themed;
}

// static
QString HighContrast::mapStyleSheet(const QString& styleSheet) {
    HighContrast* pInstance = tryInstance();
    if (!pInstance) {
        return styleSheet;
    }
    const QString themed = themeStyleSheet(styleSheet, pInstance->m_theme);
    return pInstance->m_enabled
            ? invertStyleSheet(themed, pInstance->iconCacheDir())
            : themed;
}

// static
QColor HighContrast::themeColor(const QColor& color, int theme) {
    if (theme == kDefaultTheme || !color.isValid()) {
        return color;
    }
    const QString name = color.name(QColor::HexRgb).toLower();
    const bool primary = name == QLatin1String("#c9372c") ||
            name == QLatin1String("#d73535") ||
            name == QLatin1String("#f15921");
    const bool secondary = name == QLatin1String("#855ea7") ||
            name == QLatin1String("#08537c") ||
            name == QLatin1String("#488ab3");
    if (theme == 1) {
        return primary      ? withPreservedAlpha(color, "#f2a000")
                : secondary ? withPreservedAlpha(color, "#00a6c8")
                            : color;
    }
    if (theme == 2) {
        return primary      ? withPreservedAlpha(color, "#e31b23")
                : secondary ? withPreservedAlpha(color, "#3f7cff")
                            : color;
    }
    return color;
}

// static
QString HighContrast::themeStyleSheet(const QString& styleSheet, int theme) {
    if (theme == kDefaultTheme) {
        return styleSheet;
    }
    QString out = styleSheet;
    const QString primary = theme == 1 ? QStringLiteral("#f2a000")
                                       : QStringLiteral("#e31b23");
    const QString secondary = theme == 1 ? QStringLiteral("#00a6c8")
                                         : QStringLiteral("#3f7cff");
    for (const QString& source : {QStringLiteral("#c9372c"),
                 QStringLiteral("#d73535"),
                 QStringLiteral("#f15921")}) {
        out.replace(QRegularExpression(QRegularExpression::escape(source),
                            QRegularExpression::CaseInsensitiveOption),
                primary);
    }
    for (const QString& source : {QStringLiteral("#855ea7"),
                 QStringLiteral("#08537c"),
                 QStringLiteral("#488ab3")}) {
        out.replace(QRegularExpression(QRegularExpression::escape(source),
                            QRegularExpression::CaseInsensitiveOption),
                secondary);
    }
    const QString primaryRgb = theme == 1 ? QStringLiteral("242, 160, 0")
                                          : QStringLiteral("227, 27, 35");
    const QString secondaryRgb = theme == 1 ? QStringLiteral("0, 166, 200")
                                            : QStringLiteral("63, 124, 255");
    out.replace(QRegularExpression(
                        QStringLiteral(R"(rgba\(\s*(?:215\s*,\s*53\s*,\s*53|241\s*,\s*89\s*,\s*33)\s*,\s*([^\)]+)\))"),
                        QRegularExpression::CaseInsensitiveOption),
            QStringLiteral("rgba(%1, \\1)").arg(primaryRgb));
    out.replace(QRegularExpression(
                        QStringLiteral(R"(rgba\(\s*(?:72\s*,\s*138\s*,\s*179|8\s*,\s*125\s*,\s*225)\s*,\s*([^\)]+)\))"),
                        QRegularExpression::CaseInsensitiveOption),
            QStringLiteral("rgba(%1, \\1)").arg(secondaryRgb));
    return out;
}

QString HighContrast::iconCacheDir() const {
    return m_pConfig->getSettingsPath() + QLatin1Char('/') + kIconCacheDirName;
}

void HighContrast::onEnabledChanged(double value) {
    const bool enabled = value != 0.0;
    if (enabled == m_enabled) {
        return;
    }
    m_enabled = enabled;
    // Persist so the mode survives a restart — a unit left in the sun stays
    // readable across a power cycle. Flushed to disk immediately because an
    // appliance can be hard-powered-off without ever running the exit-time
    // save, same reason as the screen rotation.
    m_pConfig->setValue(ConfigKey(kGroup, kItem), m_enabled ? 1.0 : 0.0);
    m_pConfig->save();
    emit enabledChanged(m_enabled);
}

void HighContrast::onThemeChanged(double value) {
    const int theme = std::clamp(qRound(value), 0, 2);
    if (theme == m_theme) {
        return;
    }
    m_theme = theme;
    m_pConfig->setValue(ConfigKey(kGroup, kThemeItem), m_theme);
    m_pConfig->save();
    emit themeChanged(m_theme);
}

// static
QColor HighContrast::invertColor(const QColor& color) {
    float h = 0.0f;
    float s = 0.0f;
    float l = 0.0f;
    float a = 1.0f;
    color.getHslF(&h, &s, &l, &a);
    // Achromatic colors report hue -1, which fromHslF() rejects; with zero
    // saturation the hue is arbitrary anyway.
    if (h < 0.0f) {
        h = 0.0f;
    }
    // Back to the RGB spec: QColor's comparison and serialization both care
    // which spec a color carries, and callers expect an ordinary RGB color.
    return QColor::fromHslF(h, s, 1.0f - l, a).toRgb();
}

// static
QString HighContrast::invertStyleSheet(const QString& styleSheet, const QString& iconCacheDir) {
    QString out;
    out.reserve(styleSheet.size());

    const int n = styleSheet.size();
    int i = 0;
    int braceDepth = 0;
    // True while inside a declaration's value, i.e. between the ':' of a
    // property and the ';' or '}' that ends it. Only there does a color-looking
    // token actually denote a color — the ':' in `WPushButton:hover` and the
    // words in a selector must be left alone.
    bool inValue = false;
    // Armed by a `/* no-invert */` comment and disarmed by the '}' that closes
    // the rule block after it; while armed the sheet is copied verbatim.
    bool exempt = false;

    while (i < n) {
        const QChar c = styleSheet.at(i);

        // Comments and quoted strings pass through untouched.
        if (c == QLatin1Char('/') && i + 1 < n && styleSheet.at(i + 1) == QLatin1Char('*')) {
            const int end = styleSheet.indexOf(QLatin1String("*/"), i + 2);
            const int stop = end < 0 ? n : end + 2;
            const QString comment = styleSheet.mid(i + 2, std::max(0, stop - 2 - (i + 2)));
            if (comment.trimmed() == kNoInvertMarker) {
                exempt = true;
            }
            out.append(styleSheet.mid(i, stop - i));
            i = stop;
            continue;
        }
        if (c == QLatin1Char('\'') || c == QLatin1Char('"')) {
            const int end = styleSheet.indexOf(c, i + 1);
            const int stop = end < 0 ? n : end + 1;
            out.append(styleSheet.mid(i, stop - i));
            i = stop;
            continue;
        }

        if (c == QLatin1Char('{')) {
            ++braceDepth;
            inValue = false;
        } else if (c == QLatin1Char('}')) {
            braceDepth = std::max(0, braceDepth - 1);
            inValue = false;
            if (braceDepth == 0) {
                exempt = false;
            }
        } else if (c == QLatin1Char(';')) {
            inValue = false;
        } else if (c == QLatin1Char(':')) {
            inValue = braceDepth > 0;
        }

        if (exempt || !inValue || c == QLatin1Char(':')) {
            out.append(c);
            ++i;
            continue;
        }

        if (c == QLatin1Char('#')) {
            const int len = hexColorLength(styleSheet, i);
            const QColor color = len > 0 ? QColor(styleSheet.mid(i, len)) : QColor();
            if (color.isValid()) {
                out.append(invertColor(color).name(QColor::HexRgb));
            } else {
                out.append(styleSheet.mid(i, std::max(1, len)));
            }
            i += std::max(1, len);
            continue;
        }

        if (!c.isLetter()) {
            out.append(c);
            ++i;
            continue;
        }

        int identEnd = i;
        while (identEnd < n && isIdentChar(styleSheet.at(identEnd))) {
            ++identEnd;
        }
        const QString ident = styleSheet.mid(i, identEnd - i);

        // Functional notation: url(...) may need its icon inverted, rgb()/rgba()
        // their channels.
        if (identEnd < n && styleSheet.at(identEnd) == QLatin1Char('(')) {
            const int argsLen = parenLength(styleSheet, identEnd);
            if (argsLen > 0) {
                const QString args = styleSheet.mid(identEnd + 1, argsLen - 2);
                QString replacement;
                if (ident.compare(QLatin1String("url"), Qt::CaseInsensitive) == 0) {
                    const QString path = invertedIconPath(
                            args.trimmed().remove(QLatin1Char('"')).remove(QLatin1Char('\'')),
                            iconCacheDir);
                    if (!path.isEmpty()) {
                        replacement = QStringLiteral("url(%1)").arg(path);
                    }
                } else if (ident.compare(QLatin1String("rgb"), Qt::CaseInsensitive) == 0 ||
                        ident.compare(QLatin1String("rgba"), Qt::CaseInsensitive) == 0) {
                    replacement = invertRgbFunction(ident, args);
                }
                out.append(replacement.isEmpty() ? styleSheet.mid(i, identEnd + argsLen - i)
                                                 : replacement);
                i = identEnd + argsLen;
                continue;
            }
        }

        // Named color (black, white, gray, lightgray, ...). Every other word in
        // a value — solid, dashed, bold, uppercase, px — fails this test.
        if (!isPassThroughName(ident)) {
            const QColor named = QColor::fromString(ident.toLower());
            if (named.isValid()) {
                out.append(invertColor(named).name(QColor::HexRgb));
                i = identEnd;
                continue;
            }
        }

        out.append(ident);
        i = identEnd;
    }

    return out;
}
