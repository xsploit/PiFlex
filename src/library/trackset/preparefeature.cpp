#include "library/trackset/preparefeature.h"

#include <QSet>

#include "library/library.h"
#include "library/playlisttablemodel.h"
#include "library/trackcollection.h"
#include "library/trackcollectionmanager.h"
#include "library/treeitem.h"
#include "moc_preparefeature.cpp"
#include "sources/soundsourceproxy.h"
#include "util/assert.h"

namespace {

const QString kPreparePlaylistName = QStringLiteral("PiFlex Prepare");

} // namespace

PrepareFeature::PrepareFeature(Library* pLibrary, UserSettingsPointer pConfig)
        : LibraryFeature(pLibrary, pConfig, QStringLiteral("prepare")),
          m_playlistDao(pLibrary->trackCollectionManager()
                                ->internalCollection()
                                ->getPlaylistDAO()),
          m_playlistId(kInvalidPlaylistId),
          m_pTrackModel(new PlaylistTableModel(this,
                  pLibrary->trackCollectionManager(),
                  "mixxx.db.model.prepare")),
          m_pSidebarModel(make_parented<TreeItemModel>(this)) {
    m_pSidebarModel->setRootItem(TreeItem::newRoot(this));

    // Reuse the same hidden Prepare playlist across clean restarts. Unlike a
    // normal playlist, it cannot accidentally appear among the user's
    // Rekordbox or Mixxx playlists, and it never writes to removable media.
    const auto preparePlaylists = m_playlistDao.getPlaylists(PlaylistDAO::PLHT_PREPARE);
    if (!preparePlaylists.isEmpty()) {
        m_playlistId = preparePlaylists.constFirst().first;
    } else {
        QString playlistName = kPreparePlaylistName;
        m_playlistId = m_playlistDao.createUniquePlaylist(
                &playlistName, PlaylistDAO::PLHT_PREPARE);
    }

    VERIFY_OR_DEBUG_ASSERT(m_playlistId != kInvalidPlaylistId) {
        return;
    }
    m_pTrackModel->selectPlaylist(m_playlistId);
}

QVariant PrepareFeature::title() {
    return tr("Prepare");
}

TreeItemModel* PrepareFeature::sidebarModel() const {
    return m_pSidebarModel;
}

void PrepareFeature::activate() {
    VERIFY_OR_DEBUG_ASSERT(m_playlistId != kInvalidPlaylistId) {
        return;
    }
    emit saveModelState();
    m_pTrackModel->selectPlaylist(m_playlistId);
    emit showTrackModel(m_pTrackModel);
    emit enableCoverArtDisplay(true);
}

void PrepareFeature::activateAndSelect() {
    activate();
    emit featureSelect(this, QModelIndex());
}

bool PrepareFeature::dropAccept(const QList<QUrl>& urls, QObject* pSource) {
    const QList<TrackId> trackIds =
            m_pLibrary->trackCollectionManager()->resolveTrackIdsFromUrls(
                    urls, !pSource);
    if (trackIds.isEmpty()) {
        return false;
    }
    addMissingTracks(trackIds);
    return true;
}

bool PrepareFeature::dragMoveAccept(const QUrl& url) {
    return SoundSourceProxy::isUrlSupported(url);
}

void PrepareFeature::addMissingTracks(const QList<TrackId>& trackIds) {
    QList<TrackId> missing;
    for (const TrackId& trackId : trackIds) {
        if (trackId.isValid() &&
                !m_playlistDao.isTrackInPlaylist(trackId, m_playlistId)) {
            missing.append(trackId);
        }
    }
    if (!missing.isEmpty()) {
        m_playlistDao.appendTracksToPlaylist(missing, m_playlistId);
    }
}

void PrepareFeature::toggleTracks(const QList<TrackId>& trackIds) {
    QList<TrackId> validTracks;
    bool allAlreadyPrepared = true;
    for (const TrackId& trackId : trackIds) {
        if (!trackId.isValid()) {
            continue;
        }
        validTracks.append(trackId);
        if (!m_playlistDao.isTrackInPlaylist(trackId, m_playlistId)) {
            allAlreadyPrepared = false;
        }
    }
    if (validTracks.isEmpty()) {
        return;
    }

    if (allAlreadyPrepared) {
        for (const TrackId& trackId : validTracks) {
            m_playlistDao.removeTracksFromPlaylistById(m_playlistId, trackId);
        }
    } else {
        addMissingTracks(validTracks);
    }
}

void PrepareFeature::clear() {
    const QList<TrackId> trackIds = m_playlistDao.getTrackIds(m_playlistId);
    QSet<TrackId> uniqueTrackIds;
    for (const TrackId& trackId : trackIds) {
        uniqueTrackIds.insert(trackId);
    }
    for (const TrackId& trackId : uniqueTrackIds) {
        m_playlistDao.removeTracksFromPlaylistById(m_playlistId, trackId);
    }
}
