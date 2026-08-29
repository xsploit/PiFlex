#include <gtest/gtest.h>

#include <QTemporaryDir>

#include "library/edmc/edmcsubscriptionstore.h"

namespace {

using mixxx::library::edmc::Subscription;

TEST(EdmcSubscriptionStoreTest, NormalizesOnlyEdmcGenreAndSubsectionUrls) {
    EXPECT_EQ(QUrl(QStringLiteral("https://edmc.to/genre/jump-up-145/")),
            mixxx::library::edmc::normalizeSubscriptionUrl(QUrl(QStringLiteral(
                    "http://EDMC.to/genre/jump-up-145?page=3#latest"))));
    EXPECT_TRUE(mixxx::library::edmc::normalizeSubscriptionUrl(
                        QUrl(QStringLiteral("https://example.com/genre/jump-up-145/")))
                        .isEmpty());
    EXPECT_TRUE(mixxx::library::edmc::normalizeSubscriptionUrl(
                        QUrl(QStringLiteral("https://edmc.to/music/a-release-123/")))
                        .isEmpty());
}

TEST(EdmcSubscriptionStoreTest, RoundTripsIndependentSubsectionProgress) {
    QTemporaryDir directory;
    ASSERT_TRUE(directory.isValid());
    const QString path = directory.filePath(QStringLiteral("subscriptions.json"));
    const QList<Subscription> expected({
            {QStringLiteral("Jump-Up"),
                    QUrl(QStringLiteral("https://edmc.to/genre/jump-up-145/")),
                    708681,
                    true},
            {QStringLiteral("Deep Dubstep"),
                    QUrl(QStringLiteral("https://edmc.to/genre/deep-dubstep-103/")),
                    700001,
                    false},
    });

    QString error;
    ASSERT_TRUE(mixxx::library::edmc::saveSubscriptions(path, expected, &error))
            << error.toStdString();
    EXPECT_EQ(expected,
            mixxx::library::edmc::loadSubscriptions(path, &error));
    EXPECT_TRUE(error.isEmpty()) << error.toStdString();
}

} // namespace
