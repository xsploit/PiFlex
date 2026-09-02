#pragma once

#include <QList>
#include <QUrl>
#include <QVariant>

#include "library/dao/playlistdao.h"
#include "library/libraryfeature.h"
#include "library/treeitemmodel.h"
#include "track/trackid.h"
#include "util/parented_ptr.h"

class PlaylistTableModel;

// Controller-first temporary set planning. The rows use Mixxx's playlist
// machinery, but the backing playlist has its own hidden type so it is exposed
// only through the dedicated Prepare source.
class PrepareFeature final : public LibraryFeature {
    Q_OBJECT

  public:
    PrepareFeature(Library* pLibrary, UserSettingsPointer pConfig);
    ~PrepareFeature() override = default;

    QVariant title() override;
    TreeItemModel* sidebarModel() const override;
    bool hasTrackTable() override {
        return true;
    }

    bool dropAccept(const QList<QUrl>& urls, QObject* pSource) override;
    bool dragMoveAccept(const QUrl& url) override;

    void toggleTracks(const QList<TrackId>& trackIds);
    void activateAndSelect();
    void clear() override;

  public slots:
    void activate() override;

  private:
    void addMissingTracks(const QList<TrackId>& trackIds);

    PlaylistDAO& m_playlistDao;
    int m_playlistId;
    PlaylistTableModel* m_pTrackModel;
    parented_ptr<TreeItemModel> m_pSidebarModel;
};
