const db = require('../config/database');
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
    const code = String(req.body.code || name || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!code || !name?.trim()) return res.status(400).json({ success: false, message: 'Assessment Type name is required' });
    if (!['Active', 'Inactive'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });
    const id = req.params.id || uuidv4();
    if (req.params.id) {
      await db.query(`UPDATE assessment_courses SET code=?, name=?, department='Both', default_max_score=10, status=? WHERE id=?`, [code.trim(), name.trim(), status, id]);
    } else {
      await db.query(`INSERT INTO assessment_courses (id, code, name, department, default_max_score, status, created_by) VALUES (?, ?, ?, 'Both', 10, ?, ?)`, [id, code.trim(), name.trim(), status, req.user.id]);
    }
    res.status(req.params.id ? 200 : 201).json({ success: true, data: { id } });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') error = Object.assign(new Error('Assessment Type already exists'), { status: 409 });
    sendError(res, error);
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
    if (req.query.department) { where += " AND department IN (?, 'Both')"; params.push(normalizeDepartment(req.query.department)); }
    if (req.query.status) { where += ' AND status=?'; params.push(req.query.status); }
    const [rows] = await db.query(`SELECT * FROM vessel_types ${where} ORDER BY status, name`, params);
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

module.exports = { listCourses, saveCourse, listFormulas, createFormula, activateFormula, listVesselTypes, saveVesselType };
