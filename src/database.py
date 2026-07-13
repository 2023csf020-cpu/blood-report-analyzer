"""
SQLite Database interface for Blood Report Analyzer.
Stores historical report data, profiles, and enables trend queries per profile.
"""

import sqlite3
import json
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "blood_reports.db")


def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Initializes the database schema if it doesn't already exist."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # Create profiles table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            relationship TEXT DEFAULT 'Self',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Create reports table (including profile_id)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id INTEGER DEFAULT 1,
            patient_name TEXT,
            patient_age TEXT,
            patient_sex TEXT,
            report_date TEXT,
            lab_name TEXT,
            health_score INTEGER,
            insights_json TEXT,
            raw_extracted_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE
        )
    """)


    # Create tests table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            report_id INTEGER,
            panel_name TEXT,
            test_name TEXT,
            raw_label TEXT,
            value REAL,
            value_raw TEXT,
            unit TEXT,
            ref_range_low REAL,
            ref_range_high REAL,
            ref_range_type TEXT,
            ref_range_raw TEXT,
            flag TEXT,
            FOREIGN KEY (report_id) REFERENCES reports (id) ON DELETE CASCADE
        )
    """)

    # Create default profile if none exists
    cursor.execute("SELECT COUNT(*) as count FROM profiles")
    row = cursor.fetchone()
    if row["count"] == 0:
        cursor.execute("INSERT INTO profiles (id, name, relationship) VALUES (1, 'Primary Patient', 'Self')")

    conn.commit()
    conn.close()


def create_profile(name: str, relationship: str = "Self") -> int:
    """Creates a new patient profile and returns its ID."""
    init_db()
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO profiles (name, relationship) VALUES (?, ?)",
            (name, relationship)
        )
        conn.commit()
        profile_id = cursor.lastrowid
    except sqlite3.IntegrityError:
        # Profile name already exists, return existing profile ID
        cursor.execute("SELECT id FROM profiles WHERE name = ?", (name,))
        row = cursor.fetchone()
        profile_id = row["id"] if row else 1
    conn.close()
    return profile_id


def list_profiles() -> list:
    """Returns a list of all profiles."""
    init_db()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, relationship, created_at FROM profiles ORDER BY name ASC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def delete_profile(profile_id: int) -> bool:
    """Deletes a profile. Will cascade delete all associated reports."""
    init_db()
    if profile_id == 1:
        # Protect default primary profile from deletion
        return False
    conn = get_db_connection()
    cursor = conn.cursor()
    # Enable foreign keys for cascade delete
    cursor.execute("PRAGMA foreign_keys = ON")
    cursor.execute("DELETE FROM profiles WHERE id = ?", (profile_id,))
    conn.commit()
    rows_affected = cursor.rowcount
    conn.close()
    return rows_affected > 0


def save_report(report_data: dict, profile_id: int = 1) -> int:
    """Saves a structured report payload to the database under a specific profile_id."""
    init_db()  # Ensure database is set up
    conn = get_db_connection()
    cursor = conn.cursor()

    patient = report_data.get("patient", {})
    patient_name = patient.get("name") or "Unknown"
    patient_age = patient.get("age")
    patient_sex = patient.get("sex")
    report_date = report_data.get("report_date")
    lab_name = report_data.get("lab_name")
    health_score = report_data.get("health_score", {}).get("score") if report_data.get("health_score") else None
    insights_json = json.dumps(report_data.get("insights", {}))
    raw_extracted_json = json.dumps(report_data)

    cursor.execute("""
        INSERT INTO reports (profile_id, patient_name, patient_age, patient_sex, report_date, lab_name, health_score, insights_json, raw_extracted_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (profile_id, patient_name, patient_age, patient_sex, report_date, lab_name, health_score, insights_json, raw_extracted_json))

    report_id = cursor.lastrowid

    # Insert individual tests
    for panel in report_data.get("panels", []):
        panel_name = panel.get("panel_name")
        for test in panel.get("tests", []):
            test_name = test.get("test_name")
            raw_label = test.get("raw_label")
            val = test.get("value")

            value_numeric = None
            value_raw = str(val) if val is not None else None
            if isinstance(val, (int, float)):
                value_numeric = float(val)

            unit = test.get("unit")
            ref_low = test.get("ref_range_low")
            ref_high = test.get("ref_range_high")
            ref_type = test.get("ref_range_type")
            ref_raw = test.get("ref_range_raw")
            flag = test.get("flag")

            cursor.execute("""
                INSERT INTO tests (report_id, panel_name, test_name, raw_label, value, value_raw, unit, ref_range_low, ref_range_high, ref_range_type, ref_range_raw, flag)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (report_id, panel_name, test_name, raw_label, value_numeric, value_raw, unit, ref_low, ref_high, ref_type, ref_raw, flag))

    conn.commit()
    conn.close()
    return report_id


def list_reports(profile_id: int = 1) -> list:
    """Returns a list of all saved reports under a specific profile."""
    init_db()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, patient_name, patient_age, patient_sex, report_date, lab_name, health_score, created_at 
        FROM reports 
        WHERE profile_id = ?
        ORDER BY created_at DESC
    """, (profile_id,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_report(report_id: int) -> dict:
    """Retrieves the full raw JSON of a specific saved report."""
    init_db()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT raw_extracted_json, profile_id FROM reports WHERE id = ?", (report_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        data = json.loads(row["raw_extracted_json"])
        data["db_id"] = report_id
        data["profile_id"] = row["profile_id"]
        return data
    return None


def delete_report(report_id: int) -> bool:
    """Deletes a report and associated tests from the database."""
    init_db()
    conn = get_db_connection()
    cursor = conn.cursor()
    # Enable foreign keys for cascade delete
    cursor.execute("PRAGMA foreign_keys = ON")
    cursor.execute("DELETE FROM reports WHERE id = ?", (report_id,))
    conn.commit()
    rows_affected = cursor.rowcount
    conn.close()
    return rows_affected > 0


def get_trends(profile_id: int = 1) -> dict:
    """
    Returns aggregated values for numeric tests for a specific profile,
    grouped by test name, to plot trend graphs.
    """
    init_db()
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT r.id as report_id, r.report_date, r.created_at, t.test_name, t.value, t.unit, t.ref_range_low, t.ref_range_high
        FROM tests t
        JOIN reports r ON t.report_id = r.id
        WHERE t.value IS NOT NULL AND t.test_name IS NOT NULL AND r.profile_id = ?
        ORDER BY r.created_at ASC
    """, (profile_id,))
    rows = cursor.fetchall()
    conn.close()

    trends = {}
    for row in rows:
        tname = row["test_name"]
        date = row["report_date"] or row["created_at"][:10]
        if tname not in trends:
            trends[tname] = {
                "unit": row["unit"],
                "ref_range_low": row["ref_range_low"],
                "ref_range_high": row["ref_range_high"],
                "data": []
            }
        trends[tname]["data"].append({
            "report_id": row["report_id"],
            "date": date,
            "value": row["value"]
        })

    return trends


# Make sure database initializes when this module is loaded
init_db()
