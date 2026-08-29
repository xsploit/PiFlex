#pragma once

#include <QList>
#include <QString>
#include <QUrl>

namespace mixxx::library::edmc {

struct Subscription {
    QString name;
    QUrl url;
    quint64 newestSeenTopicId = 0;
    bool enabled = true;

    bool operator==(const Subscription& other) const {
        return name == other.name && url == other.url &&
                newestSeenTopicId == other.newestSeenTopicId &&
                enabled == other.enabled;
    }
};

// Accepts EDMC genre and subsection pages, strips paging/query state, and
// returns a stable URL suitable for use as the subscription identity.
QUrl normalizeSubscriptionUrl(const QUrl& url);

QList<Subscription> loadSubscriptions(
        const QString& filePath,
        QString* errorMessage = nullptr);

// Uses QSaveFile so an interrupted write cannot destroy the previous list.
bool saveSubscriptions(const QString& filePath,
        const QList<Subscription>& subscriptions,
        QString* errorMessage = nullptr);

} // namespace mixxx::library::edmc
