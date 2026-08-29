#include <gtest/gtest.h>

#include "library/edmc/edmchtmlparser.h"

namespace {

using mixxx::library::edmc::TopicLink;

TEST(EdmcHtmlParserTest, ExtractsAndDeduplicatesTopicLinks) {
    const QString html = QStringLiteral(R"(
        <a href="/music/blank-canvas-char-call-me-708681/?do=getLastComment">Latest</a>
        <a href="https://edmc.to/music/blank-canvas-char-call-me-708681/">Title</a>
        <a href="https://edmc.to/music/deep-notion-sabotage-708679/">Second</a>
    )");

    const auto topics = mixxx::library::edmc::parseTopicLinks(html);

    ASSERT_EQ(2, topics.size());
    const TopicLink expectedFirst{
            708681,
            QUrl(QStringLiteral(
                    "https://edmc.to/music/blank-canvas-char-call-me-708681/")),
    };
    const TopicLink expectedSecond{
            708679,
            QUrl(QStringLiteral(
                    "https://edmc.to/music/deep-notion-sabotage-708679/")),
    };
    EXPECT_EQ(expectedFirst, topics.at(0));
    EXPECT_EQ(expectedSecond, topics.at(1));
}

TEST(EdmcHtmlParserTest, StopsAtNewestTopicSeenForThatSubsection) {
    const QList<TopicLink> topics({
            {708681, QUrl(QStringLiteral("https://edmc.to/music/newest-708681/"))},
            {708679, QUrl(QStringLiteral("https://edmc.to/music/new-708679/"))},
            {708670, QUrl(QStringLiteral("https://edmc.to/music/known-708670/"))},
            {708660, QUrl(QStringLiteral("https://edmc.to/music/old-708660/"))},
    });

    EXPECT_EQ(topics.mid(0, 2),
            mixxx::library::edmc::topicsUntilKnownId(topics, 708670));
    EXPECT_EQ(topics,
            mixxx::library::edmc::topicsUntilKnownId(topics, 0));
}

TEST(EdmcHtmlParserTest, ExtractsAndDeduplicatesBeatExsEmbeds) {
    const QString html = QStringLiteral(R"(
        <iframe src="https://beatexs.com/embed/moivo1mapbvk"></iframe>
        <iframe src="https://beatexs.com/embed/moivo1mapbvk"></iframe>
        <iframe src="https://beatexs.com/embed/2frvhlq2uotg"></iframe>
    )");

    EXPECT_EQ(QStringList({QStringLiteral("moivo1mapbvk"),
                      QStringLiteral("2frvhlq2uotg")}),
            mixxx::library::edmc::parseBeatExsEmbedIds(html));
}

TEST(EdmcHtmlParserTest, ExtractsPreviewAndBuildsDownloadPage) {
    const QString html = QStringLiteral(R"(
        <audio><source src="https://se3.flenxi.com/i/00177/moivo1mapbvk.mp3"></audio>
    )");

    EXPECT_EQ(QUrl(QStringLiteral(
                      "https://se3.flenxi.com/i/00177/moivo1mapbvk.mp3")),
            mixxx::library::edmc::parseBeatExsPreviewUrl(html));
    EXPECT_EQ(QUrl(QStringLiteral("https://beatexs.com/moivo1mapbvk")),
            mixxx::library::edmc::beatExsDownloadPageUrl(
                    QStringLiteral("moivo1mapbvk")));
    EXPECT_TRUE(mixxx::library::edmc::beatExsDownloadPageUrl(
                        QStringLiteral("../bad"))
                        .isEmpty());
}

} // namespace
