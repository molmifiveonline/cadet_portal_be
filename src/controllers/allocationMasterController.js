const db = require('../config/database');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { normalizeDepartment, validateFormula } = require('../services/allocationRules');

const sendError = (res, error) => res.status(error.status || 500).json({
  success: false,
  message: error.status ? error.message : 'Allocation master operation failed',
  error: process.env.NODE_ENV === 'development' ? error.message : undefined,
});

const listCourses = async (req, res) => {
  try {
    const params = [];
    let where = 'WHERE 1=1';
    if (req.query.status) {
      where += ' AND status = ?';
      params.push(req.query.status);
    }
    const [rows] = await db.query(`SELECT * FROM assessment_courses ${where} ORDER BY status, name`, params);
    res.json({ success: true, data: rows });
  } catch (error) { sendError(res, error); }
};

const saveCourse = async (req, res) => {
  try {
    const { name, status = 'Active' } = req.body;
    const normalizedName = String(name || '').trim().replace(/\s+/g, ' ');
    const errors = {};
    if (!normalizedName) errors.name = 'Assessment Type Name is required.';
    else if (!/[A-Za-z0-9]/.test(normalizedName)) errors.name = 'Assessment Type Name must contain at least one letter or number.';
    else if (normalizedName.length > 150) errors.name = 'Assessment Type Name cannot exceed 150 characters.';
    if (!['Active', 'Inactive'].includes(status)) errors.status = 'Status must be Active or Inactive.';
    if (Object.keys(errors).length) {
      return res.status(400).json({ success: false, message: 'Please correct the highlighted assessment fields.', errors });
    }

    const id = req.params.id || uuidv4();
    const [existingRows] = req.params.id
      ? await db.query(`SELECT * FROM assessment_courses WHERE id=?`, [id])
      : [[]];
    if (req.params.id && !existingRows[0]) {
      return res.status(404).json({ success: false, message: 'Assessment Type not found' });
    }
    const [duplicates] = await db.query(
      `SELECT id FROM assessment_courses WHERE LOWER(TRIM(name))=LOWER(?) AND id<>? LIMIT 1`,
      [normalizedName, id],
    );
    if (duplicates.length) {
      return res.status(409).json({
        success: false,
        message: 'Assessment Type already exists.',
        errors: { name: 'Use a different Assessment Type Name.' },
      });
    }

    const rawCode = normalizedName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const code = existingRows[0]?.code || (rawCode.length <= 50
      ? rawCode
      : `${rawCode.slice(0, 41)}_${crypto.createHash('sha1').update(normalizedName).digest('hex').slice(0, 8).toUpperCase()}`);
    if (req.params.id) {
      await db.query(`UPDATE assessment_courses SET name=?, department='Both', default_max_score=10, status=? WHERE id=?`, [normalizedName, status, id]);
    } else {
      await db.query(`INSERT INTO assessment_courses (id, code, name, department, default_max_score, status, created_by) VALUES (?, ?, ?, 'Both', 10, ?, ?)`, [id, code, normalizedName, status, req.user.id]);
    }
    res.status(req.params.id ? 200 : 201).json({
      success: true,
      message: req.params.id ? 'Assessment Type updated' : 'Assessment Type added',
      data: { id, code, name: normalizedName, department: 'Both', default_max_score: 10, status },
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: 'Assessment Type already exists.',
        errors: { name: 'Use a different Assessment Type Name.' },
      });
    }
    sendError(res, error);
  }
};

const deleteCourse = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [courses] = await connection.query(
      `SELECT id, name FROM assessment_courses WHERE id=? FOR UPDATE`,
      [req.params.id],
    );
    if (!courses[0]) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'Assessment Type not found',
      });
    }

    const [[usage]] = await connection.query(
      `SELECT
         (SELECT COUNT(*) FROM score_formula_components WHERE course_id=?) AS formula_count,
         (SELECT COUNT(*) FROM allocation_score_entries WHERE course_id=?) AS score_count`,
      [req.params.id, req.params.id],
    );
    if (Number(usage.formula_count) > 0 || Number(usage.score_count) > 0) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message:
          'This Assessment Type is already in use and cannot be deleted. Deactivate it instead to preserve allocation history.',
      });
    }

    await connection.query(`DELETE FROM assessment_courses WHERE id=?`, [
      req.params.id,
    ]);
    await connection.commit();
    return res.json({
      success: true,
      message: `${courses[0].name} deleted successfully`,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      error = Object.assign(
        new Error(
          'This Assessment Type is already in use and cannot be deleted. Deactivate it instead to preserve allocation history.',
        ),
        { status: 409 },
      );
    }
    sendError(res, error);
  } finally {
    if (connection) connection.release();
  }
};

const listFormulas = async (req, res) => {
  try {
    const params = [];
    let where = '';
    if (req.query.department) { where = 'WHERE f.department = ?'; params.push(normalizeDepartment(req.query.department)); }
    const [rows] = await db.query(
      `SELECT f.*, u.email AS created_by_email
       FROM score_formula_templates f LEFT JOIN users u ON u.id=f.created_by
       ${where} ORDER BY f.department, f.version DESC`, params,
    );
    if (rows.length) {
      const [components] = await db.query(
        `SELECT fc.*, c.code AS course_code, c.name AS course_name
         FROM score_formula_components fc JOIN assessment_courses c ON c.id=fc.course_id
         WHERE fc.template_id IN (?) ORDER BY fc.sort_order, c.name`, [rows.map((row) => row.id)],
      );
      const grouped = components.reduce((map, item) => {
        (map[item.template_id] ||= []).push(item); return map;
      }, {});
      rows.forEach((row) => { row.components = grouped[row.id] || []; });
    }
    res.json({ success: true, data: rows });
  } catch (error) { sendError(res, error); }
};

const createFormula = async (req, res) => {
  let connection;
  try {
    const { name, department, academic_weight, components, activate = false } = req.body;
    const normalizedDepartment = normalizeDepartment(department);
    if (!name?.trim() || !normalizedDepartment) return res.status(400).json({ success: false, message: 'Name and Deck/Engine department are required' });
    validateFormula({ academic_weight, components });
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [courseRows] = await connection.query(`SELECT id, department, status FROM assessment_courses WHERE id IN (?)`, [components.map((c) => c.course_id)]);
    if (courseRows.length !== components.length || courseRows.some((course) => course.status !== 'Active' || ![normalizedDepartment, 'Both'].includes(course.department))) {
      throw Object.assign(new Error('Every formula course must be active and compatible with the department'), { status: 400 });
    }
    const [versionRows] = await connection.query(`SELECT COALESCE(MAX(version),0)+1 AS version FROM score_formula_templates WHERE name=? AND department=? FOR UPDATE`, [name.trim(), normalizedDepartment]);
    const id = uuidv4();
    if (activate) await connection.query(`UPDATE score_formula_templates SET status='Inactive' WHERE department=? AND status='Active'`, [normalizedDepartment]);
    await connection.query(`INSERT INTO score_formula_templates (id,name,department,version,academic_weight,status,created_by) VALUES (?,?,?,?,?,?,?)`, [id, name.trim(), normalizedDepartment, versionRows[0].version, academic_weight, activate ? 'Active' : 'Draft', req.user.id]);
    for (let index = 0; index < components.length; index += 1) {
      const component = components[index];
      await connection.query(`INSERT INTO score_formula_components (id,template_id,course_id,weight,max_score,sort_order) VALUES (?,?,?,?,?,?)`, [uuidv4(), id, component.course_id, component.weight, component.max_score, index]);
    }
    await connection.commit();
    res.status(201).json({ success: true, data: { id, version: versionRows[0].version } });
  } catch (error) {
    if (connection) await connection.rollback();
    if (!error.status && error.message?.includes('weight')) error.status = 400;
    sendError(res, error);
  } finally { if (connection) connection.release(); }
};

const activateFormula = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection(); await connection.beginTransaction();
    const [rows] = await connection.query(`SELECT * FROM score_formula_templates WHERE id=? FOR UPDATE`, [req.params.id]);
    if (!rows[0]) throw Object.assign(new Error('Formula template not found'), { status: 404 });
    await connection.query(`UPDATE score_formula_templates SET status='Inactive' WHERE department=? AND status='Active'`, [rows[0].department]);
    await connection.query(`UPDATE score_formula_templates SET status='Active' WHERE id=?`, [req.params.id]);
    await connection.commit(); res.json({ success: true, message: 'Formula activated' });
  } catch (error) { if (connection) await connection.rollback(); sendError(res, error); }
  finally { if (connection) connection.release(); }
};

const listVesselTypes = async (req, res) => {
  try {
    const params = []; let where = 'WHERE 1=1';
    if (req.query.department) { where += " AND vt.department IN (?, 'Both')"; params.push(normalizeDepartment(req.query.department)); }
    if (req.query.status) { where += ' AND vt.status=?'; params.push(req.query.status); }
    const [rows] = await db.query(
      `SELECT vt.*, COUNT(v.id) AS active_vessel_count
       FROM vessel_types vt
       JOIN vessels v ON v.vessel_type_id=vt.id AND v.status='Active'
       ${where}
       GROUP BY vt.id
       ORDER BY vt.status, vt.name`,
      params,
    );
    res.json({ success: true, data: rows });
  } catch (error) { sendError(res, error); }
};

const saveVesselType = async (req, res) => {
  try {
    const { name, department = 'Both', status = 'Active' } = req.body;
    if (!name?.trim() || !['Deck','Engine','Both'].includes(department)) return res.status(400).json({ success: false, message: 'Valid name and department are required' });
    const id = req.params.id || uuidv4();
    if (req.params.id) await db.query(`UPDATE vessel_types SET name=?,department=?,status=? WHERE id=?`, [name.trim(), department, status, id]);
    else await db.query(`INSERT INTO vessel_types (id,name,department,status,created_by) VALUES (?,?,?,?,?)`, [id, name.trim(), department, status, req.user.id]);
    res.status(req.params.id ? 200 : 201).json({ success: true, data: { id } });
  } catch (error) { if (error.code === 'ER_DUP_ENTRY') error = Object.assign(new Error('Vessel type already exists'), { status: 409 }); sendError(res, error); }
};

module.exports = { listCourses, saveCourse, deleteCourse, listFormulas, createFormula, activateFormula, listVesselTypes, saveVesselType };
