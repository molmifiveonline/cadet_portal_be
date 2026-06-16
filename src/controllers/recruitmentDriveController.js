const recruitmentDriveDao = require("../dao/recruitmentDriveDao");
const activityLogDao = require("../dao/activityLogDao");
const instituteDao = require("../dao/instituteDao");
const cadetDao = require("../dao/cadetDao");
const assessmentDao = require("../dao/assessmentDao");
const interviewDao = require("../dao/interviewDao");
const medicalDao = require("../dao/cadetMedicalResultsDao");
const documentDao = require("../dao/documentDao");
const recruitmentCommunicationDao = require("../dao/recruitmentCommunicationDao");
const {
  DEFAULT_PAGE_SIZE,
  ROLES,
  DRIVE_STATUS,
  SUBMISSION_STATUS,
} = require("../config/constants");
const {
  processImport,
  parseSubmissionData,
} = require("./instituteSubmissionController");
const {
  WORKFLOW_PHASES,
  DISPLAY_STATUS,
  buildWorkflowUpdate,
  COMMUNICATION_TYPES,
} = require("../services/recruitmentWorkflowService");
const {
  logAndSendBatchEmail,
  emailTemplates,
} = require("../services/recruitmentCommunicationService");

const FRONTEND_URL = process.env.FRONTEND_URL || "";
const INVITE_CONCURRENCY = 5;

const mapById = (items = []) =>
  new Map(items.map((item) => [String(item.id), item]));

const runWithConcurrency = async (items, limit, worker) => {
  const results = [];
  let index = 0;

  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (index < items.length) {
        const currentIndex = index;
        index += 1;
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    },
  );

  await Promise.all(runners);
  return results;
};

const getCadetDisplayName = (cadet = {}) =>
  cadet.name_as_in_indos_cert || cadet.cadet_unique_id || cadet.id || "Cadet";

const getInstituteRecipientForCadet = async (cadet = {}, instituteCache) => {
  if (!cadet.institute_id) return null;

  const instituteId = String(cadet.institute_id);
  if (!instituteCache.has(instituteId)) {
    instituteCache.set(instituteId, instituteDao.getInstituteById(cadet.institute_id));
  }

  const institute = await instituteCache.get(instituteId);
  const email = instituteDao.getDefaultContactEmail(institute);
  if (!institute || !email) return null;

  return { institute, email };
};

const appendCadetRemark = (remarks, cadet = {}) => {
  const cadetLine = `Cadet: ${getCadetDisplayName(cadet)} (${cadet.cadet_unique_id || cadet.id})`;
  return [cadetLine, remarks].filter(Boolean).join("\n\n");
};

const addInstituteBatchItem = (batches, recipient, item) => {
  const key = `${recipient.email}|${item.institute_id}`;
  if (!batches.has(key)) {
    batches.set(key, {
      recipient,
      items: [],
    });
  }
  batches.get(key).items.push(item);
};

const sendStageInviteBatches = async ({
  batches,
  subject,
  message,
  dateLabel = "Date",
  timeLabel = "Time",
  locationLabel = "Location",
  communicationType,
  sentBy,
  attachments = [],
  showLocation = true,
  showLink = true,
}) => {
  for (const batch of batches.values()) {
    await logAndSendBatchEmail({
      to: batch.recipient.email,
      template: emailTemplates.stageInviteBatch,
      templateData: {
        subject,
        recipientName: batch.recipient.institute.institute_name,
        message,
        dateLabel,
        timeLabel,
        locationLabel,
        cadets: batch.items,
        showLocation,
        showLink,
      },
      attachments,
      communications: batch.items.map((item) => ({
        drive_id: item.drive_id,
        cadet_id: item.cadetId,
        institute_id: item.institute_id,
        communication_type: communicationType,
        remarks: item.remarks,
        sent_by: sentBy,
        payload_json: {
          subject,
          ...item,
        },
      })),
    });
  }
};

// ... (skipping to the function implementation later in the file)

const previewSubmitCadets = async (req, res) => {
  try {
    const { id } = req.params;
    const drive = await recruitmentDriveDao.getRecruitmentDriveById(id);
    if (!drive) {
      return res.status(404).json({ message: "Recruitment drive not found" });
    }

    // Find the latest pending/uploaded submission for this drive
    const { data: submissions } = await instituteDao.getAllSubmissions(
      1,
      0,
      SUBMISSION_STATUS.UPLOADED,
      "",
      drive.institute_id,
      drive.year,
      drive.course_type,
      drive.id,
    );

    if (!submissions || submissions.length === 0) {
      return res.status(400).json({
        message:
          "No pending submissions found for this institute and drive details.",
      });
    }

    const latestSubmission = submissions[0];

    // Parse but don't import
    const { cadets } = await parseSubmissionData(latestSubmission.id, id);

    res.json({
      success: true,
      data: cadets,
      cadets,
      total: cadets.length,
      submission_id: latestSubmission.id,
      submission: {
        id: latestSubmission.id,
        institute_id: latestSubmission.institute_id,
        institute_name: latestSubmission.institute_name,
        original_name: latestSubmission.original_name,
        batch_year: latestSubmission.batch_year,
        course_type: latestSubmission.course_type,
        remarks: latestSubmission.remarks,
        created_at: latestSubmission.created_at,
      },
    });
  } catch (error) {
    console.error("Preview Submit Cadets Error:", error);
    res.status(500).json({
      message: "Error parsing cadet data for preview",
      error: error.message,
    });
  }
};

const createRecruitmentDrive = async (req, res) => {
  try {
    const {
      drive_name,
      institute_id,
      course_type,
      year,
      intake_capacity,
      eligibility_criteria,
      status,
    } = req.body;

    if (!drive_name || !institute_id || !course_type) {
      return res.status(400).json({ message: "Required fields are missing" });
    }

    const parsedYear =
      year === undefined || year === null || year === ""
        ? new Date().getFullYear()
        : parseInt(year, 10);

    if (Number.isNaN(parsedYear)) {
      return res.status(400).json({ message: "Year must be a valid number" });
    }

    const duplicateByName =
      await recruitmentDriveDao.getDriveByName(drive_name);
    if (duplicateByName) {
      return res
        .status(409)
        .json({ message: "Recruitment drive name already exists" });
    }

    const duplicateByContext =
      await recruitmentDriveDao.getDriveByInstituteYearCourseType(
        institute_id,
        parsedYear,
        course_type,
      );
    if (duplicateByContext) {
      return res.status(409).json({
        message:
          "A recruitment drive already exists for this institute, year, and course type",
      });
    }

    const id = await recruitmentDriveDao.createRecruitmentDrive({
      drive_name,
      institute_id,
      course_type,
      year: parsedYear,
      intake_capacity: intake_capacity || 0,
      eligibility_criteria,
      status: status || "Draft",
    });

    // Log activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        "CREATE_RECRUITMENT_DRIVE",
        `Created recruitment drive: ${drive_name}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.status(201).json({
      message: "Recruitment drive created successfully",
      id,
    });
  } catch (error) {
    console.error("Create Recruitment Drive Error:", error);
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message:
          "A recruitment drive already exists for this institute, year, and course type",
      });
    }
    res.status(500).json({
      message: "Error creating recruitment drive",
      error: error.message,
    });
  }
};

const getAllRecruitmentDrives = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || DEFAULT_PAGE_SIZE;
    const search = req.query.search || "";
    let institute_id = req.query.institute_id;
    const course_type = req.query.course_type;
    const status = req.query.status;
    const year = req.query.year || req.query.batch_year;

    if (req.user && req.user.role === "Institute") {
      institute_id = req.user.instituteId || req.user.id;
    }

    const offset = (page - 1) * limit;

    const filters = {
      institute_id,
      course_type,
      status,
      year,
      search,
    };

    const { data, total } = await recruitmentDriveDao.getAllRecruitmentDrives(
      limit,
      offset,
      filters,
    );

    res.json({
      data,
      total,
      page,
      limit,
      search,
    });
  } catch (error) {
    console.error("Get All Recruitment Drives Error:", error);
    res.status(500).json({
      message: "Error fetching recruitment drives",
      error: error.message,
    });
  }
};

const getRecruitmentDriveById = async (req, res) => {
  try {
    const { id } = req.params;
    const drive = await recruitmentDriveDao.getRecruitmentDriveById(id);

    if (!drive) {
      return res.status(404).json({ message: "Recruitment drive not found" });
    }

    if (
      req.user &&
      req.user.role === "Institute" &&
      drive.institute_id !== (req.user.instituteId || req.user.id)
    ) {
      return res
        .status(403)
        .json({ message: "Access denied to this recruitment drive" });
    }

    res.json({ data: drive });
  } catch (error) {
    console.error("Get Recruitment Drive By Id Error:", error);
    res.status(500).json({
      message: "Error fetching recruitment drive",
      error: error.message,
    });
  }
};

const updateRecruitmentDrive = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      drive_name,
      institute_id,
      course_type,
      year,
      intake_capacity,
      eligibility_criteria,
      status,
    } = req.body;

    let parsedYear;
    if (year !== undefined && year !== null && year !== "") {
      parsedYear = parseInt(year, 10);
      if (Number.isNaN(parsedYear)) {
        return res.status(400).json({ message: "Year must be a valid number" });
      }
    }

    const existingDrive = await recruitmentDriveDao.getRecruitmentDriveById(id);
    if (!existingDrive) {
      return res.status(404).json({ message: "Recruitment drive not found" });
    }

    const resolvedDriveName = drive_name ?? existingDrive.drive_name;
    const resolvedInstituteId = institute_id ?? existingDrive.institute_id;
    const resolvedCourseType = course_type ?? existingDrive.course_type;
    const resolvedYear = parsedYear ?? existingDrive.year;

    if (resolvedDriveName) {
      const duplicateByName = await recruitmentDriveDao.getDriveByName(
        resolvedDriveName,
        id,
      );
      if (duplicateByName) {
        return res
          .status(409)
          .json({ message: "Recruitment drive name already exists" });
      }
    }

    const duplicateByContext =
      await recruitmentDriveDao.getDriveByInstituteYearCourseType(
        resolvedInstituteId,
        resolvedYear,
        resolvedCourseType,
        id,
      );
    if (duplicateByContext) {
      return res.status(409).json({
        message:
          "A recruitment drive already exists for this institute, year, and course type",
      });
    }

    const success = await recruitmentDriveDao.updateRecruitmentDrive(id, {
      drive_name,
      institute_id,
      course_type,
      year: parsedYear,
      intake_capacity,
      eligibility_criteria,
      status,
    });

    if (!success) {
      return res.status(404).json({ message: "Recruitment drive not found" });
    }

    // Log activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        "UPDATE_RECRUITMENT_DRIVE",
        `Updated recruitment drive: ${id}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({ message: "Recruitment drive updated successfully" });
  } catch (error) {
    console.error("Update Recruitment Drive Error:", error);
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message:
          "A recruitment drive already exists for this institute, year, and course type",
      });
    }
    res.status(500).json({
      message: "Error updating recruitment drive",
      error: error.message,
    });
  }
};

const deleteRecruitmentDrive = async (req, res) => {
  try {
    if (req.user && req.user.role === ROLES.INSTITUTE) {
      return res.status(403).json({
        message: "Institute users are not allowed to delete recruitment drives",
      });
    }

    const { id } = req.params;
    const force = req.query.force === "true";

    const deleteResult = await recruitmentDriveDao.deleteRecruitmentDrive(id, force);

    if (deleteResult.reason === "not_found") {
      return res.status(404).json({ message: "Recruitment drive not found" });
    }

    if (deleteResult.reason === "has_cadets") {
      return res.status(409).json({
        message:
          "This recruitment drive has cadets/progress. Close the drive instead of deleting it.",
        cadetCount: deleteResult.cadetCount,
      });
    }

    if (!deleteResult.success) {
      return res.status(500).json({
        message: "Recruitment drive could not be deleted",
      });
    }

    // Log activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        "DELETE_RECRUITMENT_DRIVE",
        `Deleted recruitment drive: ${deleteResult.driveName || id}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({
      message: "Recruitment drive deleted successfully",
      detachedSubmissions: deleteResult.detachedSubmissions,
      detachedCommunications: deleteResult.detachedCommunications,
    });
  } catch (error) {
    console.error("Delete Recruitment Drive Error:", error);
    res.status(500).json({
      message: "Error deleting recruitment drive",
      error: error.message,
    });
  }
};

const getRecruitmentDriveStats = async (req, res) => {
  try {
    const { id } = req.params;
    if (req.user && req.user.role === "Institute") {
      const drive = await recruitmentDriveDao.getRecruitmentDriveById(id);

      if (!drive) {
        return res.status(404).json({ message: "Recruitment drive not found" });
      }

      if (drive.institute_id !== (req.user.instituteId || req.user.id)) {
        return res
          .status(403)
          .json({ message: "Access denied to this recruitment drive" });
      }
    }

    const stats = await recruitmentDriveDao.getRecruitmentDriveStats(id);

    res.json({ data: stats });
  } catch (error) {
    console.error("Get Recruitment Drive Stats Error:", error);
    res.status(500).json({
      message: "Error fetching recruitment drive stats",
      error: error.message,
    });
  }
};

const getDriveCadetQueue = async (req, res) => {
  try {
    const { id } = req.params;
    const queue = req.query.queue || "all";
    const search = req.query.search || "";
    const status = req.query.status || "all";
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE, 1),
      100,
    );
    const offset = (page - 1) * limit;
    const sortBy = req.query.sortBy || "created_at";
    const sortOrder = req.query.sortOrder || "DESC";
    const excludeUploaded =
      req.query.excludeUploaded === "true" || req.query.exclude_uploaded === "true";

    if (req.user && req.user.role === "Institute") {
      const drive = await recruitmentDriveDao.getRecruitmentDriveById(id);
      if (!drive) {
        return res.status(404).json({ message: "Recruitment drive not found" });
      }

      if (drive.institute_id !== (req.user.instituteId || req.user.id)) {
        return res
          .status(403)
          .json({ message: "Access denied to this recruitment drive" });
      }
    }

    const [data, total] = await Promise.all([
      cadetDao.getDriveCadets(id, {
        queue,
        search,
        status,
        limit,
        offset,
        sortBy,
        sortOrder,
        excludeUploaded,
      }),
      cadetDao.getDriveCadetsCount(id, {
        queue,
        search,
        status,
        excludeUploaded,
      }),
    ]);

    res.json({
      success: true,
      data,
      total,
      page,
      limit,
      pagination: {
        current_page: page,
        per_page: limit,
        total,
        last_page: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error("Get Drive Cadet Queue Error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching drive cadets",
      error: error.message,
    });
  }
};

const getDriveCommunications = async (req, res) => {
  try {
    const { id } = req.params;
    const data = await recruitmentCommunicationDao.getDriveCommunications(id);
    res.json({ success: true, data });
  } catch (error) {
    console.error("Get Drive Communications Error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching drive communications",
      error: error.message,
    });
  }
};

const submitCadetDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const drive = await recruitmentDriveDao.getRecruitmentDriveById(id);
    if (!drive) {
      return res.status(404).json({ message: "Recruitment drive not found" });
    }

    // Find the latest pending/uploaded submission for this drive
    const { data: submissions } = await instituteDao.getAllSubmissions(
      1,
      0,
      SUBMISSION_STATUS.UPLOADED,
      "",
      drive.institute_id,
      drive.year,
      drive.course_type,
      drive.id,
    );

    if (!submissions || submissions.length === 0) {
      return res.status(400).json({
        message:
          "No pending submissions found for this institute and drive details. Please ask institute to upload first.",
      });
    }

    const latestSubmission = submissions[0];

    // Import cadets
    const stats = await processImport(
      latestSubmission.id,
      req.user?.id,
      req.ip || req.connection.remoteAddress,
      id, // drive_id
    );

    // Update drive status
    await recruitmentDriveDao.updateRecruitmentDrive(id, {
      status: DRIVE_STATUS.SUBMITTED,
    });

    res.json({
      success: true,
      message: "Cadets submitted successfully to the drive",
      stats: {
        ...stats,
        total: stats.success + stats.failed,
      },
      submission_id: latestSubmission.id,
    });
  } catch (error) {
    console.error("Submit Cadet Details Error:", error);
    res.status(500).json({
      message: "Error submitting cadets",
      error: error.message,
    });
  }
};

const finalizeShortlist = async (req, res) => {
  try {
    const { id } = req.params;
    await recruitmentDriveDao.updateRecruitmentDrive(id, {
      status: DRIVE_STATUS.SHORTLISTED,
    });
    res.json({ success: true, message: "Shortlist finalized successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error finalizing shortlist", error: error.message });
  }
};

const shortlistCadets = async (req, res) => {
  try {
    const { id } = req.params;
    const { cadet_ids } = req.body;

    if (!Array.isArray(cadet_ids) || cadet_ids.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "cadet_ids is required" });
    }

    await cadetDao.bulkUpdateCadets(
      cadet_ids,
      buildWorkflowUpdate({
        phase: WORKFLOW_PHASES.SHORTLISTED,
        result: "pending",
        status: DISPLAY_STATUS.SHORTLISTED,
        extraFields: {
          shortlisted_at: new Date(),
        },
      }),
    );

    await recruitmentDriveDao.updateRecruitmentDrive(id, {
      status: DRIVE_STATUS.SHORTLISTED,
    });

    res.json({ success: true, message: "Cadets shortlisted successfully" });
  } catch (error) {
    console.error("Shortlist Cadets Error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Error shortlisting cadets",
        error: error.message,
      });
  }
};

const sendAssessmentInvites = async (req, res) => {
  try {
    const { id } = req.params;
    let { cadets = [] } = req.body;

    // Handle FormData stringified cadets
    if (typeof cadets === 'string') {
      try {
        cadets = JSON.parse(cadets);
      } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid cadets data' });
      }
    }

    const assessmentFile = req.file;
    const pendingDetailsNames = [];
    const cadetIds = cadets.map((cadetInvite) => cadetInvite.cadet_id).filter(Boolean);
    const cadetMap = mapById(await cadetDao.getCadetsByIds(cadetIds));
    const instituteCache = new Map();
    const emailBatches = new Map();

    await runWithConcurrency(cadets, INVITE_CONCURRENCY, async (cadetInvite) => {
      const cadet = cadetMap.get(String(cadetInvite.cadet_id));
      if (!cadet || cadet.drive_id !== id) return;

      const recipient = await getInstituteRecipientForCadet(cadet, instituteCache);
      if (!recipient) return;

      if (!Number(cadet.institute_detail_filled || 0)) {
        pendingDetailsNames.push(cadet.name_as_in_indos_cert);
        return;
      }

      let documentLink = cadetInvite.document_link;

      // If a file was uploaded, save it as a document for this cadet
      if (assessmentFile) {
        const documentId = await documentDao.createDocument({
          cadet_id: cadet.id,
          document_name: 'Assessment Instructions',
          document_type: 'OTHER',
          document_data: assessmentFile.buffer,
          document_mime_type: assessmentFile.mimetype,
          original_filename: assessmentFile.originalname,
          status: 'pending',
          source: 'portal',
        });

        // Generate download link for the email
        documentLink = `${FRONTEND_URL || ''}/api/documents/download/${documentId}`;
      }

      await assessmentDao.createOrUpdateAssessment({
        cadet_id: cadet.id,
        assessment_date: cadetInvite.assessment_date,
        assessment_time: cadetInvite.assessment_time,
        invite_remark: cadetInvite.remarks,
        invite_document_link: documentLink,
      });

      await cadetDao.updateCadet(
        cadet.id,
        buildWorkflowUpdate({
          phase: WORKFLOW_PHASES.ASSESSMENT,
          result: "invited",
          status: DISPLAY_STATUS.SHORTLISTED,
        }),
      );

      addInstituteBatchItem(emailBatches, recipient, {
        drive_id: id,
        cadetId: cadet.id,
        cadetName: getCadetDisplayName(cadet),
        cadetUniqueId: cadet.cadet_unique_id,
        institute_id: cadet.institute_id,
        date: cadetInvite.assessment_date,
        time: cadetInvite.assessment_time,
        remarks: appendCadetRemark(cadetInvite.remarks, cadet),
        documentLink,
      });
    });

    const attachments = [];
    if (assessmentFile) {
      attachments.push({
        filename: assessmentFile.originalname,
        content: assessmentFile.buffer,
        contentType: assessmentFile.mimetype,
      });
    }

    await sendStageInviteBatches({
      batches: emailBatches,
      subject: "Assessment invites - MOLMI",
      message:
        "The following cadet(s) are eligible for the assessment stage. Please review the assessment schedule below.",
      communicationType: COMMUNICATION_TYPES.ASSESSMENT_INVITE,
      sentBy: req.user?.id || null,
      attachments,
      showLocation: false,
      showLink: false,
    });

    if (pendingDetailsNames.length > 0) {
      return res.json({
        success: true,
        message: `Assessment invites sent, but ${pendingDetailsNames.length} cadets were skipped because their details are still pending from the institute: ${pendingDetailsNames.join(', ')}.`,
        skippedCount: pendingDetailsNames.length,
        skippedCadets: pendingDetailsNames,
      });
    }

    res.json({
      success: true,
      message: "Assessment invites sent successfully",
    });
  } catch (error) {
    console.error("Send Assessment Invites Error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Error sending assessment invites",
        error: error.message,
      });
  }
};

const sendInterviewInvites = async (req, res) => {
  try {
    const { id } = req.params;
    const { cadets = [] } = req.body;
    const cadetIds = cadets.map((cadetInvite) => cadetInvite.cadet_id).filter(Boolean);
    const cadetMap = mapById(await cadetDao.getCadetsByIds(cadetIds));
    const instituteCache = new Map();
    const emailBatches = new Map();

    await runWithConcurrency(cadets, INVITE_CONCURRENCY, async (cadetInvite) => {
      const cadet = cadetMap.get(String(cadetInvite.cadet_id));
      if (!cadet || cadet.drive_id !== id) return;

      const recipient = await getInstituteRecipientForCadet(cadet, instituteCache);
      if (!recipient) return;

      await interviewDao.createOrUpdateInterview({
        cadet_id: cadet.id,
        interview_date: cadetInvite.interview_date,
        interview_time: cadetInvite.interview_time,
        invite_remark: cadetInvite.remarks,
        invite_document_link: cadetInvite.document_link,
      });

      await cadetDao.updateCadet(
        cadet.id,
        buildWorkflowUpdate({
          phase: WORKFLOW_PHASES.INTERVIEW,
          result: "invited",
          status: DISPLAY_STATUS.ASSESSMENT,
        }),
      );

      addInstituteBatchItem(emailBatches, recipient, {
        drive_id: id,
        cadetId: cadet.id,
        cadetName: getCadetDisplayName(cadet),
        cadetUniqueId: cadet.cadet_unique_id,
        institute_id: cadet.institute_id,
        date: cadetInvite.interview_date,
        time: cadetInvite.interview_time,
        remarks: appendCadetRemark(cadetInvite.remarks, cadet),
        documentLink: cadetInvite.document_link,
      });
    });

    await sendStageInviteBatches({
      batches: emailBatches,
      subject: "Interview invites - MOLMI",
      message:
        "The following cadet(s) are eligible for the face-to-face interview stage. Please review the interview schedule below.",
      communicationType: COMMUNICATION_TYPES.INTERVIEW_INVITE,
      sentBy: req.user?.id || null,
      showLocation: false,
    });

    // Advance drive status to Assessment Completed when interview invites go out.
    const driveForInterview =
      await recruitmentDriveDao.getRecruitmentDriveById(id);
    const interviewStatusOrder = [
      DRIVE_STATUS.DRAFT,
      DRIVE_STATUS.REQUESTED,
      DRIVE_STATUS.RECEIVED,
      DRIVE_STATUS.SUBMITTED,
      DRIVE_STATUS.SHORTLISTED,
      DRIVE_STATUS.ASSESSMENT_COMPLETED,
      DRIVE_STATUS.INTERVIEW_COMPLETED,
      DRIVE_STATUS.MEDICAL_COMPLETED,
      DRIVE_STATUS.CLOSED,
    ];
    if (
      driveForInterview &&
      interviewStatusOrder.indexOf(driveForInterview.status) <
        interviewStatusOrder.indexOf(DRIVE_STATUS.ASSESSMENT_COMPLETED)
    ) {
      await recruitmentDriveDao.updateRecruitmentDrive(id, {
        status: DRIVE_STATUS.ASSESSMENT_COMPLETED,
      });
    }

    res.json({ success: true, message: "Interview invites sent successfully" });
  } catch (error) {
    console.error("Send Interview Invites Error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Error sending interview invites",
        error: error.message,
      });
  }
};

const sendMedicalInvites = async (req, res) => {
  try {
    const { id } = req.params;
    const { cadets = [] } = req.body;
    const cadetIds = cadets.map((cadetInvite) => cadetInvite.cadet_id).filter(Boolean);
    const cadetMap = mapById(await cadetDao.getCadetsByIds(cadetIds));
    const instituteCache = new Map();
    const emailBatches = new Map();

    await runWithConcurrency(cadets, INVITE_CONCURRENCY, async (cadetInvite) => {
      const cadet = cadetMap.get(String(cadetInvite.cadet_id));
      if (!cadet || cadet.drive_id !== id) return;

      const recipient = await getInstituteRecipientForCadet(cadet, instituteCache);
      if (!recipient) return;

      await medicalDao.createOrUpdateMedicalResult({
        cadet_id: cadet.id,
        medical_date: cadetInvite.medical_date,
        medical_time: cadetInvite.medical_time,
        medical_center_id: cadetInvite.medical_center_id,
        invite_remark: cadetInvite.remarks,
      });

      await cadetDao.updateCadet(
        cadet.id,
        buildWorkflowUpdate({
          phase: WORKFLOW_PHASES.MEDICAL,
          result: "invited",
          status: DISPLAY_STATUS.SELECTED,
        }),
      );

      addInstituteBatchItem(emailBatches, recipient, {
        drive_id: id,
        cadetId: cadet.id,
        cadetName: getCadetDisplayName(cadet),
        cadetUniqueId: cadet.cadet_unique_id,
        institute_id: cadet.institute_id,
        date: cadetInvite.medical_date,
        time: cadetInvite.medical_time,
        location:
          cadetInvite.medical_location ||
          cadetInvite.medical_center_name ||
          "Medical Center",
        remarks: appendCadetRemark(cadetInvite.remarks, cadet),
      });
    });

    await sendStageInviteBatches({
      batches: emailBatches,
      subject: "Medical invites - MOLMI",
      message:
        "The following cadet(s) are eligible for the medical / profiling stage. Please review the appointment details below.",
      locationLabel: "Medical Location",
      communicationType: COMMUNICATION_TYPES.MEDICAL_INVITE,
      sentBy: req.user?.id || null,
    });

    // Advance drive status to Interview Completed when medical invites go out.
    const driveForMedical =
      await recruitmentDriveDao.getRecruitmentDriveById(id);
    const medicalStatusOrder = [
      DRIVE_STATUS.DRAFT,
      DRIVE_STATUS.REQUESTED,
      DRIVE_STATUS.RECEIVED,
      DRIVE_STATUS.SUBMITTED,
      DRIVE_STATUS.SHORTLISTED,
      DRIVE_STATUS.ASSESSMENT_COMPLETED,
      DRIVE_STATUS.INTERVIEW_COMPLETED,
      DRIVE_STATUS.MEDICAL_COMPLETED,
      DRIVE_STATUS.CLOSED,
    ];
    if (
      driveForMedical &&
      medicalStatusOrder.indexOf(driveForMedical.status) <
        medicalStatusOrder.indexOf(DRIVE_STATUS.INTERVIEW_COMPLETED)
    ) {
      await recruitmentDriveDao.updateRecruitmentDrive(id, {
        status: DRIVE_STATUS.INTERVIEW_COMPLETED,
      });
    }

    res.json({ success: true, message: "Medical invites sent successfully" });
  } catch (error) {
    console.error("Send Medical Invites Error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Error sending medical invites",
        error: error.message,
      });
  }
};

const finalizeAssessment = async (req, res) => {
  try {
    const { id } = req.params;
    await recruitmentDriveDao.updateRecruitmentDrive(id, {
      status: DRIVE_STATUS.ASSESSMENT_COMPLETED,
    });
    res.json({ success: true, message: "Assessment finalized successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error finalizing assessment", error: error.message });
  }
};

const finalizeInterview = async (req, res) => {
  try {
    const { id } = req.params;
    await recruitmentDriveDao.updateRecruitmentDrive(id, {
      status: DRIVE_STATUS.INTERVIEW_COMPLETED,
    });
    res.json({ success: true, message: "Interview finalized successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error finalizing interview", error: error.message });
  }
};

const finalizeMedical = async (req, res) => {
  try {
    const { id } = req.params;
    await recruitmentDriveDao.updateRecruitmentDrive(id, {
      status: DRIVE_STATUS.MEDICAL_COMPLETED,
    });
    res.json({
      success: true,
      message: "Medical stage finalized successfully",
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error finalizing medical", error: error.message });
  }
};

const closeDrive = async (req, res) => {
  try {
    const { id } = req.params;
    await recruitmentDriveDao.updateRecruitmentDrive(id, {
      status: DRIVE_STATUS.CLOSED,
    });
    res.json({ success: true, message: "Drive closed successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error closing drive", error: error.message });
  }
};

const getPendingDriveCount = async (req, res) => {
  try {
    const role = req.user.role;
    const userId = req.user.instituteId || req.user.id;

    if (role !== "Institute") {
      return res.json({ success: true, count: 0 });
    }

    const count = await recruitmentDriveDao.getPendingDriveCount(userId);
    res.json({ success: true, count });
  } catch (error) {
    console.error("Get Pending Drive Count Error:", error);
    res
      .status(500)
      .json({ success: false, message: "Error fetching pending drive count" });
  }
};

module.exports = {
  createRecruitmentDrive,
  getAllRecruitmentDrives,
  getRecruitmentDriveById,
  updateRecruitmentDrive,
  deleteRecruitmentDrive,
  getRecruitmentDriveStats,
  getDriveCadetQueue,
  getDriveCommunications,
  submitCadetDetails,
  previewSubmitCadets,
  shortlistCadets,
  sendAssessmentInvites,
  sendInterviewInvites,
  sendMedicalInvites,
  finalizeShortlist,
  finalizeAssessment,
  finalizeInterview,
  finalizeMedical,
  closeDrive,
  getPendingDriveCount,
};
