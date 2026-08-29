#include "library/edmc/edmcsubscriptionstore.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSaveFile>

namespace mixxx::library::edmc {

namespace {

constexpr int kFormatVersion = 1;

void setError(QString* errorMessage, const QString& message) {
    if (errorMessage) {
        *errorMessage = message;
    }
}

} // namespace

QUrl normalizeSubscriptionUrl(const QUrl& url) {
    if (!url.isValid() || !url.userInfo().isEmpty() ||
            url.host().compare(QStringLiteral("edmc.to"), Qt::CaseInsensitive) != 0) {
        return {};
    }

    QString path = url.path();
    if (!path.startsWith(QStringLiteral("/genre/")) || path.size() <= 7) {
        return {};
    }
    if (!path.endsWith(QLatin1Char('/'))) {
        path.append(QLatin1Char('/'));
    }

    QUrl normalized;
    normalized.setScheme(QStringLiteral("https"));
    normalized.setHost(QStringLiteral("edmc.to"));
    normalized.setPath(path);
    return normalized;
}

QList<Subscription> loadSubscriptions(
        const QString& filePath,
        QString* errorMessage) {
    QFile file(filePath);
    if (!file.exists()) {
        return {};
    }
    if (!file.open(QIODevice::ReadOnly)) {
        setError(errorMessage, file.errorString());
        return {};
    }

    QJsonParseError parseError;
    const QJsonDocument document = QJsonDocument::fromJson(file.readAll(), &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
        setError(errorMessage,
                parseError.error == QJsonParseError::NoError
                        ? QStringLiteral("Subscription file is not a JSON object")
                        : parseError.errorString());
        return {};
    }

    const QJsonObject root = document.object();
    if (root.value(QStringLiteral("version")).toInt() != kFormatVersion ||
            !root.value(QStringLiteral("subscriptions")).isArray()) {
        setError(errorMessage, QStringLiteral("Unsupported subscription file format"));
        return {};
    }

    QList<Subscription> subscriptions;
    const QJsonArray array = root.value(QStringLiteral("subscriptions")).toArray();
    for (const QJsonValue& value : array) {
        if (!value.isObject()) {
            continue;
        }
        const QJsonObject object = value.toObject();
        const QUrl url = normalizeSubscriptionUrl(
                QUrl(object.value(QStringLiteral("url")).toString()));
        const QString name = object.value(QStringLiteral("name")).toString().trimmed();
        if (url.isEmpty() || name.isEmpty()) {
            continue;
        }
        subscriptions.append(Subscription{
                name,
                url,
                object.value(QStringLiteral("newestSeenTopicId"))
                        .toString()
                        .toULongLong(),
                object.value(QStringLiteral("enabled")).toBool(true),
        });
    }
    return subscriptions;
}

bool saveSubscriptions(const QString& filePath,
        const QList<Subscription>& subscriptions,
        QString* errorMessage) {
    const QFileInfo fileInfo(filePath);
    if (!fileInfo.dir().mkpath(QStringLiteral("."))) {
        setError(errorMessage, QStringLiteral("Unable to create subscription directory"));
        return false;
    }

    QJsonArray array;
    for (const Subscription& subscription : subscriptions) {
        const QUrl url = normalizeSubscriptionUrl(subscription.url);
        const QString name = subscription.name.trimmed();
        if (url.isEmpty() || name.isEmpty()) {
            continue;
        }
        QJsonObject object;
        object.insert(QStringLiteral("name"), name);
        object.insert(QStringLiteral("url"), url.toString());
        // JSON numbers cannot represent every quint64 exactly. A decimal string
        // preserves EDMC's topic ID without truncation.
        object.insert(QStringLiteral("newestSeenTopicId"),
                QString::number(subscription.newestSeenTopicId));
        object.insert(QStringLiteral("enabled"), subscription.enabled);
        array.append(object);
    }

    QJsonObject root;
    root.insert(QStringLiteral("version"), kFormatVersion);
    root.insert(QStringLiteral("subscriptions"), array);

    QSaveFile file(filePath);
    if (!file.open(QIODevice::WriteOnly)) {
        setError(errorMessage, file.errorString());
        return false;
    }
    if (file.write(QJsonDocument(root).toJson(QJsonDocument::Indented)) < 0 ||
            !file.commit()) {
        setError(errorMessage, file.errorString());
        return false;
    }
    return true;
}

} // namespace mixxx::library::edmc
