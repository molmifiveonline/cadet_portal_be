const recruitmentDriveDao = require("../dao/recruitmentDriveDao");
const activityLogDao = require("../dao/activityLogDao");
const instituteDao = require("../dao/instituteDao");
const cadetDao = require("../dao/cadetDao");
const assessmentDao = require("../dao/assessmentDao");
const interviewDao = require("../dao/interviewDao");
const medicalDao = require("../dao/cadetMedicalResultsDao");
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
  logAndSendEmail,
  emailTemplates,
} = require("../services/recruitmentCommunicationService");

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

    if (req.user && req.user.role === "Institute") {
      institute_id = req.user.instituteId || req.user.id;
    }

    const offset = (page - 1) * limit;

    const filters = {
      institute_id,
      course_type,
      status,
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
    let drive = await recruitmentDriveDao.getRecruitmentDriveById(id);

    if (!drive) {
      return res.status(404).json({ message: "Recruitment drive not found" });
    }

    // Self-healing: Sync status if it's lagging behind actual data flags.
    // We compute the highest stage the data justifies and advance the drive
    // status to that stage if the stored status is behind.
    const STATUS_ORDER = [
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

    const currentStatusIndex = STATUS_ORDER.indexOf(drive.status);

    // Determine the highest stage justified by the live data
    let justifiedStatus = drive.status;

    if (Number(drive.medical_queue_count) > 0) {
      justifiedStatus = DRIVE_STATUS.MEDICAL_COMPLETED;
    } else if (Number(drive.interview_selected) > 0) {
      justifiedStatus = DRIVE_STATUS.INTERVIEW_COMPLETED;
    } else if (Number(drive.assessment_passed) > 0) {
      justifiedStatus = DRIVE_STATUS.ASSESSMENT_COMPLETED;
    } else if (Number(drive.shortlisted_count) > 0) {
      justifiedStatus = DRIVE_STATUS.SHORTLISTED;
    } else if (Number(drive.total_uploaded) > 0) {
      justifiedStatus = DRIVE_STATUS.SUBMITTED;
    } else if (Number(drive.institute_reverted_excel)) {
      justifiedStatus = DRIVE_STATUS.RECEIVED;
    }

    const justifiedStatusIndex = STATUS_ORDER.indexOf(justifiedStatus);
    const needsUpdate = justifiedStatusIndex > currentStatusIndex;

    if (needsUpdate) {
      await recruitmentDriveDao.updateRecruitmentDrive(id, {
        status: justifiedStatus,
      });
      // Re-fetch to get updated state (including updated_at etc)
      drive = await recruitmentDriveDao.getRecruitmentDriveById(id);
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

    const success = await recruitmentDriveDao.deleteRecruitmentDrive(id);

    if (!success) {
      return res.status(404).json({ message: "Recruitment drive not found" });
    }

    // Log activity
    if (req.user && req.user.id) {
      await activityLogDao.createLog(
        req.user.id,
        "DELETE_RECRUITMENT_DRIVE",
        `Deleted recruitment drive: ${id}`,
        req.ip || req.connection.remoteAddress,
      );
    }

    res.json({ message: "Recruitment drive deleted successfully" });
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

    const data = await cadetDao.getDriveCadets(id, { queue, search });
    res.json({ success: true, data });
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
    const { cadets = [] } = req.body;

    const pendingDetailsNames = [];
    for (const cadetInvite of cadets) {
      const cadet = await cadetDao.getCadetById(cadetInvite.cadet_id);
      if (!cadet || cadet.drive_id !== id || !cadet.email_id) continue;

      if (!Number(cadet.institute_detail_filled || 0)) {
        pendingDetailsNames.push(cadet.name_as_in_indos_cert);
        continue;
      }

      await assessmentDao.createOrUpdateAssessment({
        cadet_id: cadet.id,
        assessment_date: cadetInvite.assessment_date,
        assessment_time: cadetInvite.assessment_time,
        invite_remark: cadetInvite.remarks,
        invite_document_link: cadetInvite.document_link,
      });

      await cadetDao.updateCadet(
        cadet.id,
        buildWorkflowUpdate({
          phase: WORKFLOW_PHASES.ASSESSMENT,
          result: "invited",
          status: DISPLAY_STATUS.SHORTLISTED,
        }),
      );

      await logAndSendEmail({
        to: cadet.email_id,
        template: emailTemplates.stageInvite,
        templateData: {
          subject:
            cadetInvite.subject ||
            `Assessment invite for ${cadet.name_as_in_indos_cert}`,
          recipientName: cadet.name_as_in_indos_cert,
          message:
            "You are eligible for the assessment stage. Please review the assessment schedule below.",
          date: cadetInvite.assessment_date,
          time: cadetInvite.assessment_time,
          remarks: cadetInvite.remarks,
          documentLink: cadetInvite.document_link,
        },
        drive_id: id,
        cadet_id: cadet.id,
        institute_id: cadet.institute_id,
        communication_type: COMMUNICATION_TYPES.ASSESSMENT_INVITE,
        remarks: cadetInvite.remarks,
        sent_by: req.user?.id || null,
      });
    }

    // Advance drive status: once assessment invites are sent, the drive is at least at Shortlisted stage.
    // (No dedicated "Assessment In Progress" status exists, so we leave the drive at Shortlisted
    // until assessment is finalised via finalizeAssessment.)
    // Nothing extra needed here – status remains Shortlisted until finalized.

    if (pendingDetailsNames.length > 0) {
      return res.json({
        success: true,
        message: `Assessment invites sent, but ${pendingDetailsNames.length} cadets were skipped because their details are still pending from the institute: ${pendingDetailsNames.join(', ')}.`,
        skippedCount: pendingDetailsNames.length,
        skippedCadets: pendingDetailsNames
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

    for (const cadetInvite of cadets) {
      const cadet = await cadetDao.getCadetById(cadetInvite.cadet_id);
      if (!cadet || cadet.drive_id !== id || !cadet.email_id) continue;

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

      await logAndSendEmail({
        to: cadet.email_id,
        template: emailTemplates.stageInvite,
        templateData: {
          subject:
            cadetInvite.subject ||
            `Interview invite for ${cadet.name_as_in_indos_cert}`,
          recipientName: cadet.name_as_in_indos_cert,
          message:
            "You are eligible for the face-to-face interview stage. Please review the interview schedule below.",
          date: cadetInvite.interview_date,
          time: cadetInvite.interview_time,
          remarks: cadetInvite.remarks,
          documentLink: cadetInvite.document_link,
        },
        drive_id: id,
        cadet_id: cadet.id,
        institute_id: cadet.institute_id,
        communication_type: COMMUNICATION_TYPES.INTERVIEW_INVITE,
        remarks: cadetInvite.remarks,
        sent_by: req.user?.id || null,
      });
    }

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

    for (const cadetInvite of cadets) {
      const cadet = await cadetDao.getCadetById(cadetInvite.cadet_id);
      if (!cadet || cadet.drive_id !== id || !cadet.email_id) continue;

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

      await logAndSendEmail({
        to: cadet.email_id,
        template: emailTemplates.stageInvite,
        templateData: {
          subject:
            cadetInvite.subject ||
            `Medical invite for ${cadet.name_as_in_indos_cert}`,
          recipientName: cadet.name_as_in_indos_cert,
          message:
            "You are eligible for the medical / profiling stage. Please review the appointment details below.",
          date: cadetInvite.medical_date,
          time: cadetInvite.medical_time,
          location:
            cadetInvite.medical_location ||
            cadetInvite.medical_center_name ||
            "Medical Center",
          locationLabel: "Medical Location",
          remarks: cadetInvite.remarks,
        },
        drive_id: id,
        cadet_id: cadet.id,
        institute_id: cadet.institute_id,
        communication_type: COMMUNICATION_TYPES.MEDICAL_INVITE,
        remarks: cadetInvite.remarks,
        sent_by: req.user?.id || null,
      });
    }

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
