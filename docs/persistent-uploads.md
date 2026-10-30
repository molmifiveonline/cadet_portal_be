# Persistent uploads on Dokploy

This deployment uses a Hostinger VPS with Dokploy containers. All existing upload writers and readers still use the backend's `uploads` directory. File IDs, filenames, `/uploads/...` URLs, interview endpoints, and the medical upload limit/database fallback remain unchanged.

## Verified live recovery — 26 October 2026

The live Nixpacks application now binds `/srv/molmi-cadet/uploads` on the VPS to `/app/uploads` in its container. Recovery merged 172 unique files without overwriting existing files. Preservation copies and the SHA-256 manifest remain under `/srv/molmi-cadet/recovery/20261026T124227Z`.

A full deployment replaced the original container, and a subsequent application reload replaced it again. All 172 recovered files retained their hashes. A harmless hidden test file written through the application container also survived the second replacement. The production application source was unchanged.

All 10 interview PDFs for HIMT-14102026D opened through the live authenticated API with matching hashes after deployment. Medical preview and health returned HTTP 200. The wider interview audit found 67 of 68 files available; attachment `41abed4f-2e2e-4285-b048-b82e2ed3f227`, outside this drive, remains unavailable. Its stored file `83487759-a86b-4c58-aad7-0a325e472686.pdf` was absent from the recovered sources.

Keep the same host path and mount on future deployments. Persistence is provided by the verified Dokploy bind mount and requires no application startup guard.

## One-time setup

1. Download a fresh copy of current uploads before changing the running container. Keep the supplied recovery archive separately. Do not restore the whole VPS to recover only uploads.
2. In **Dokploy → backend application → Advanced → Volumes**, create a **Bind Mount** with host path **`/srv/molmi-cadet/uploads`** and container path **`/app/uploads`**. The live Nixpacks backend's `/app/uploads` path was confirmed in its container; keep its build type and existing application settings.
3. Prepare the host directory and merge the current files and recovered backup into it before redeployment. Do not put the host directory inside Dokploy's source checkout or container filesystem. An empty mount hides files in the previous container; it does not migrate them automatically.
4. Deploy the backend with that same bind mount. The source directory remains on the VPS when the application image or container is replaced.
5. Open existing interview sheets for HIMT-14102026D, upload another test document, redeploy, and confirm both old and new documents still open.

The Dokploy mount must refer to the same host directory on every deployment. Verify the running container's mount after storage configuration changes; it cannot protect against manual deletion of the host directory. A full VPS restore can also roll back that directory, so keep separate backups.

## Restore without overwriting current files

Extract the archive into a separate staging directory first; the supplied archive has a top-level `uploads-backup-current` directory. Keep original generated filenames, since database records refer to them. Merge files, not database records.

Before merging, validate stored filenames and compare each existing destination file by hash. Copy only missing files; stop if the same filename has different contents. Do not overwrite or delete current files to resolve a conflict. After merging, verify the copied contents and reopen the attachment links through the application. Back up the permanent directory separately from source code. The preservation copies for this recovery are under `/srv/molmi-cadet/recovery/` on the VPS; they are not application build inputs.

## Deployment boundaries

- Uploaded customer documents and recovery artifacts are excluded from new Git additions by `.gitignore`; already tracked files remain tracked. Git exclusions do not delete files or provide storage persistence.
- The live application uses Nixpacks. Preserve its actual upload path and the Dokploy bind mount when changing deployment configuration; an application image is not an uploads backup.
- Local development keeps its current `uploads` directory.
- Restoring files on a workstation alone does not restore the production VPS. For this recovery, both the live mount and production restoration were applied and verified as recorded above.

## Owner reference: Hostinger, Dokploy, and uploads

### Your current setup

| Item | Value / purpose |
| --- | --- |
| Hosting | Hostinger VPS running Ubuntu 24.04 and Dokploy |
| VPS IP at recovery | `72.62.229.205` |
| VPS hostname at recovery | `srv1366159.hstgr.cloud` |
| Portal | `https://cadet.molminavis.com` |
| API | `https://cadet-api.molminavis.com` |
| Dokploy panel at recovery | `http://72.62.229.205:3000` |
| Backend build type | Nixpacks; unchanged during this recovery |
| Permanent upload folder on VPS | `/srv/molmi-cadet/uploads` |
| Same folder as seen by backend | `/app/uploads` |
| Dokploy storage setting | Advanced → Volumes → Bind Mount |
| Recovery copies | `/srv/molmi-cadet/recovery/20261026T124227Z` |
| Local project documentation | `D:\molmi-cadet\cadet_portal_be\docs\persistent-uploads.md` |

The backend application page is [available here](http://72.62.229.205:3000/dashboard/project/DOanqCAnhd2Ec2wdaan3t/environment/9wLUDhX02Taissf9mrdK2/services/application/Y8XM7cI7c-jhUHrCjmAnA). These addresses identify this server; update this record if you migrate it. No passwords, private keys, or bearer tokens belong in this document.

### What happened before and why this fixes it

The recovery found uploads distributed across retained backend containers. Files written only into a container's own filesystem are not automatically copied to its replacement. The database can retain an attachment record and URL even when the new container lacks the corresponding PDF. This explains the observed combination of visible attachment entries and HTTP 404 responses. The recovery did not establish that a particular medical-report code change deleted the files.

The bind mount connects the backend's `/app/uploads` to the VPS folder `/srv/molmi-cadet/uploads`. These are two views of the same files, not two upload copies that need synchronization. A write to the mounted container path writes to the host folder; the next container mounts that same host folder and can read those files immediately. Docker documents this behavior in its [bind mount guide](https://docs.docker.com/engine/storage/bind-mounts/).

```text
User uploads a PDF
        |
        v
Cadet API receives the file and saves its record
        |
        v
/app/uploads/<stored filename>       inside the backend container
        ||
        || same mounted files
        ||
/srv/molmi-cadet/uploads/<filename>  on the Hostinger VPS disk
        |
        v
Later API requests read the saved file and return its contents
```

Generated UUID filenames avoid collisions between different users uploading documents with the same name. Database metadata links the stored filename to the original display name, cadet, and attachment ID. Keep the stored filenames unchanged during recovery. Renaming files manually without updating the correct database references can break existing links.

### SSH: what you enabled

You used Hostinger's Web Console to add Dokploy's existing public SSH key to root's `authorized_keys`. That allowed Dokploy's host terminal to authenticate to this VPS. It did not itself create upload persistence or change the file URLs. Persistence came from the separate host folder and bind mount configured afterward.

The public key file was `/etc/dokploy/ssh/auto_generated-dokploy-local.pub`; the permitted-key list was `/root/.ssh/authorized_keys`. The private key stayed with Dokploy. The setup preserved existing authorized keys and did not change the root password. This access persists after the terminal closes, until the matching authorization is removed or the key changes.

The one-time setup already completed was:

```sh
mkdir -p /root/.ssh
chmod 700 /root/.ssh
touch /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
grep -qxF -f /etc/dokploy/ssh/auto_generated-dokploy-local.pub /root/.ssh/authorized_keys || cat /etc/dokploy/ssh/auto_generated-dokploy-local.pub >> /root/.ssh/authorized_keys
```

You do not need to run it before each deployment. On a different server, first verify that the intended Dokploy public key file exists and belongs to that installation; do not assume this path or key should be reused everywhere. Do not paste a private key or server password into chat or source control.

### Where to find the files

Use Hostinger → VPS → Manage → Web Console, or Dokploy → Server → Terminal. This opens a Linux server terminal. A Hostinger Domains page does not browse VPS files. These Linux paths also do not refer to your Windows project folder.

The following commands only inspect the current server data:

```sh
ls -lah /srv/molmi-cadet/uploads
du -sh /srv/molmi-cadet/uploads
df -h /srv/molmi-cadet/uploads
find /srv/molmi-cadet/uploads -maxdepth 1 -type f | wc -l
```

`du` shows upload-folder usage; `df` shows capacity and free space on its filesystem. The file count can include the harmless hidden persistence test file, so it need not equal the 172 recovered documents. New uploads and intentional deletions also change the count.

An SFTP client such as WinSCP or FileZilla can browse `/srv/molmi-cadet/uploads` after you sign in with your own server credentials. Downloading a file does not change its server copy. Files on your Windows workstation are separate copies and are not automatically synchronized with this VPS.

### Normal deployments from now on

1. Open the same backend application in Dokploy.
2. Confirm Advanced → Volumes still contains BIND host `/srv/molmi-cadet/uploads`, mount `/app/uploads`.
3. Before important changes, make a current uploads backup and a database backup.
4. Deploy the intended source version through the normal Dokploy flow. Keep the existing mount and build configuration unless a migration is planned.
5. Check deployment status and application logs.
6. Open an older interview PDF and a medical report. After a storage-related change, also check a newly uploaded document and confirm it is available after container replacement.

There is no need to restore the old archive on every deployment. Old and new uploads accumulate in the same permanent host folder. The mount's generic orange redeploy reminder can remain visible after a successful deployment; it is not itself evidence that the live mount is missing.

Changing build type or moving the backend working directory can change the path where code expects uploads. If that happens, inspect the new application's actual upload directory and mount the same preserved host folder there before accepting new uploads. Keep the host source path fixed. A new empty source path would show an empty directory even though the original files still exist elsewhere.

For an administrator checking the actual running container:

```sh
docker ps --format 'table {{.ID}}\t{{.Names}}\t{{.Status}}'
```

Identify the backend container, then replace `BACKEND_CONTAINER_ID` below with that ID; container IDs change during deployments:

```sh
docker inspect BACKEND_CONTAINER_ID --format '{{json .Mounts}}'
```

The output should include `Type: bind`, `Source: /srv/molmi-cadet/uploads`, and `Destination: /app/uploads`. These commands are run on the VPS host, not inside an application terminal or Windows PowerShell.

### Which actions retain data

| Action | Expected upload behavior |
| --- | --- |
| Normal build or redeploy with the same mount | Files retained |
| Backend container replacement with the same mount | Files retained |
| Normal VPS reboot | Files retained on disk; application temporarily unavailable |
| Frontend deployment | Does not move this backend upload folder |
| Application code rollback | Files normally remain; does not undo database/schema changes or intentional deletions |
| Change mount to an empty host folder | Existing files unavailable through that mount until corrected |
| Delete a report through an application delete feature | The intended file/record can be removed; persistence does not prevent deletion |
| Delete the host upload folder or reinstall the VPS | Data can be lost; recovery requires a backup |
| Restore an older full VPS backup | Current VPS contents replaced by the older state |
| Move to another VPS | Requires copying files, database data, and deployment configuration |

Disk capacity and persistence are separate concerns. More storage does not make a container's own filesystem durable. Your earlier screenshot showed 100 GB disk capacity and a separate bandwidth allowance; use `df` or the current VPS plan page to verify actual capacity rather than assuming a 1 TB figure is upload disk space. The host folder shares VPS disk space with the OS, databases, logs, Docker images, and backups.

### Backup routine for future use

Three different things need protection: source/configuration, database records (and any database file contents), and uploaded files. A Git repository does not contain new runtime uploads. An uploads archive alone does not restore cadet records, attachment links, or database-stored medical report contents. If the database is hosted outside this VPS, a Hostinger VPS backup does not automatically include that external database.

Keep an independently stored copy of uploads plus a database backup, particularly before major changes. The recovery directory on this same VPS is useful for immediate recovery, but it is not protection against losing or restoring the entire VPS. No new recurring off-server backup job was configured during this recovery.

To create a manual uploads archive on the VPS, run this in its host terminal. It creates a new private backup directory and does not delete or restore anything:

```sh
backup_dir=$(mktemp -d /srv/molmi-cadet/recovery/manual-XXXXXXXX)
tar -C /srv/molmi-cadet -czf "$backup_dir/uploads.tar.gz" uploads
sha256sum "$backup_dir/uploads.tar.gz" > "$backup_dir/uploads.tar.gz.sha256"
printf 'Backup directory: %s\n' "$backup_dir"
```

Proceed only if `tar` exits successfully. If files are changing during the archive, retry during a quiet period or coordinate a pause in writes. For a consistent application recovery point, coordinate the database backup with the files backup. Use your database service's supported export/backup mechanism; the exact command depends on where it runs and its credentials.

Download the archive, checksum file, and database export to secure storage outside this VPS using SFTP. Verify the archive against its checksum after transfer. Record its date and occasionally test restoring copies into a separate environment. Treat uploaded documents and database exports as private data.

Dokploy's built-in Volume Backups supports Docker named volumes, not bind mounts. Therefore this application's current bind mount is not automatically protected merely because a Volume Backups tab exists. Use host-folder backups for this setup; changing to a named volume would require a separate preservation and migration plan. [Dokploy Volume Backups documentation](https://docs.dokploy.com/docs/core/volume-backups).

### Hostinger Restore versus recovering only uploads

Hostinger → VPS → Manage → Backups & Monitoring → Snapshots & Backups manages VPS backups. Its Restore action restores the whole VPS state; it is not a code-only restore or a merge of selected uploads. Hostinger states that it overwrites current VPS contents. Code, local databases, uploads, and server configuration can all revert to that backup's state; a database outside the VPS follows its own backup system. [Hostinger restore documentation](https://www.hostinger.com/support/1583232-how-to-back-up-or-restore-a-vps-at-hostinger/).

If you restore an older VPS backup without separately preserving recent data, newer uploads and local database changes can be lost. To recover only missing PDFs while retaining current data, preserve current files and database first, obtain the old files in a separate recovery environment or staging directory, and merge missing files using exact stored filenames. Do not restore the whole live VPS just to retrieve a PDF.

The one-time recovery helpers were removed from the application source during cleanup. Any future restore should follow the non-overwriting merge procedure above, with a reviewed recovery tool and separate staging directory. After a merge, audit attachment links; restoring a file cannot recreate a missing database record.

### URLs, BLOBs, and filenames

There are three different things you may see:

| Example | Meaning |
| --- | --- |
| `/uploads/<uuid>.pdf` | API static-file route that maps a stored filename to upload storage |
| `/api/interviews/<cadet-id>/attachments/<attachment-id>` | Application endpoint that resolves the authorized attachment record and returns its contents |
| `blob:https://cadet.molminavis.com/...` | Temporary browser object URL created after fetching file contents |

The medical frontend calls its authenticated file API with `responseType: 'blob'`, then uses `URL.createObjectURL` to open the returned bytes. A `blob:` address is a temporary preview reference within the browser; it is not the permanent server storage address or a durable shareable link. Seeing it does not mean the original file has moved to browser-only storage. A database BLOB is different again: it is binary file content stored in a database. Current local medical code supports a database copy and an older disk fallback. Back up both storage and the database rather than assuming every historical report has both copies.

Open saved reports through the cadet's application page. A preview's `blob:` URL should not be stored as an attachment link. We did not change medical-report business logic during this persistence setup.

### Diagnosing an attachment problem

1. Identify whether the error is an API/server error, an authentication error, or an expiring browser preview reference.
2. For an API 404, identify the attachment's exact stored filename from its database record or trusted application logs.
3. Check for that filename in `/srv/molmi-cadet/uploads` and check the running backend's mount. A URL string or database path cannot recreate absent file bytes.
4. If the file exists but cannot be read, inspect permissions and application logs; do not rename the file or broadly change permissions as a guess.
5. If absent, inspect preservation copies and independent backups. Recover only the correct file and retain any existing current version.
6. Reopen it through the authenticated application endpoint to verify the actual content, not only a filesystem listing.

For upload-size failures, check the actual response and the application's upload limit, proxy limit, database packet limit, and available disk space. Those limits are separate from total VPS capacity; changing this mount does not raise a 10 MB per-file limit.

### Recovery result and remaining limitation

The 26 October recovery copied current live uploads and files from retained containers, merged the supplied archive without overwriting existing files, saved preservation copies and hashes, configured the live mount, then verified a full deploy and another container replacement. There were 172 unique recovered upload files, all hash-verified. All 10 HIMT interview PDFs opened through the live API. Medical preview and health returned HTTP 200. Across 68 interview attachments, 67 opened; the one missing file outside HIMT remains listed in the verification section above.

The harmless hidden `.persistence-check-...json` file was only used to confirm that a write made by one container was visible after replacement; it contains no patient data. The recorded file counts describe the recovery date, not an ongoing live monitor. No complete VPS restore was performed, and the live application source/build type was unchanged. Unused local Dockerfile, Compose, legacy lookup, startup guard, and one-time recovery helpers were subsequently removed from the application source. That cleanup does not change the live Dokploy mount or uploaded documents.
