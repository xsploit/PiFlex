#pragma once

#include <QList>
#include <QString>
#include <QStringList>
#include <QUrl>

namespace mixxx::library::edmc {

struct TopicLink {
    quint64 id;
    QUrl url;

    bool operator==(const TopicLink& other) const {
        return id == other.id && url == other.url;
    }
};

QList<TopicLink> parseTopicLinks(const QString& html);
QList<TopicLink> topicsUntilKnownId(
        const QList<TopicLink>& topics,
        quint64 newestSeenTopicId);
QStringList parseBeatExsEmbedIds(const QString& html);
QUrl parseBeatExsPreviewUrl(const QString& html);
QUrl beatExsDownloadPageUrl(const QString& id);

} // namespace mixxx::library::edmc
