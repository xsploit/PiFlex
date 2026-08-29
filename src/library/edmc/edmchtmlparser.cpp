#include "library/edmc/edmchtmlparser.h"

#include <QRegularExpression>
#include <QSet>

namespace mixxx::library::edmc {

QList<TopicLink> parseTopicLinks(const QString& html) {
    static const QRegularExpression kTopicExpression(
            QStringLiteral(
                    R"((?:https?://edmc\.to)?(/music/[^"'<>\s?]+-(\d+)/)(?:\?[^"'<>\s]*)?)"),
            QRegularExpression::CaseInsensitiveOption);

    QList<TopicLink> topics;
    QSet<quint64> seenIds;
    auto matchIterator = kTopicExpression.globalMatch(html);
    while (matchIterator.hasNext()) {
        const auto match = matchIterator.next();
        bool ok = false;
        const quint64 id = match.captured(2).toULongLong(&ok);
        if (!ok || seenIds.contains(id)) {
            continue;
        }
        seenIds.insert(id);
        topics.append(TopicLink{
                id,
                QUrl(QStringLiteral("https://edmc.to") + match.captured(1)),
        });
    }
    return topics;
}

QList<TopicLink> topicsUntilKnownId(
        const QList<TopicLink>& topics,
        quint64 newestSeenTopicId) {
    if (newestSeenTopicId == 0) {
        return topics;
    }

    QList<TopicLink> newTopics;
    for (const TopicLink& topic : topics) {
        if (topic.id == newestSeenTopicId) {
            break;
        }
        newTopics.append(topic);
    }
    return newTopics;
}

QStringList parseBeatExsEmbedIds(const QString& html) {
    static const QRegularExpression kEmbedExpression(
            QStringLiteral(R"(https://beatexs\.com/embed/([A-Za-z0-9]+))"),
            QRegularExpression::CaseInsensitiveOption);

    QStringList ids;
    QSet<QString> seenIds;
    auto matchIterator = kEmbedExpression.globalMatch(html);
    while (matchIterator.hasNext()) {
        const QString id = matchIterator.next().captured(1);
        if (id.isEmpty() || seenIds.contains(id)) {
            continue;
        }
        seenIds.insert(id);
        ids.append(id);
    }
    return ids;
}

QUrl parseBeatExsPreviewUrl(const QString& html) {
    static const QRegularExpression kPreviewExpression(
            QStringLiteral(
                    R"(https://[A-Za-z0-9.-]+/i/[0-9]+/[A-Za-z0-9]+\.mp3)"),
            QRegularExpression::CaseInsensitiveOption);
    const auto match = kPreviewExpression.match(html);
    return match.hasMatch() ? QUrl(match.captured(0)) : QUrl();
}

QUrl beatExsDownloadPageUrl(const QString& id) {
    static const QRegularExpression kValidId(QStringLiteral(R"(^[A-Za-z0-9]+$)"));
    if (!kValidId.match(id).hasMatch()) {
        return {};
    }
    return QUrl(QStringLiteral("https://beatexs.com/") + id);
}

} // namespace mixxx::library::edmc
