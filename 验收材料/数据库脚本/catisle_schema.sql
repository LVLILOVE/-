-- ============================================================
-- 猫屿 CAT ISLE 数据库建表脚本（SQLite）
-- 导出时间: 2026-08-28 | 表数量: 9
-- 生成方式: SQLAlchemy models 对应 sqlite_master 导出
-- ============================================================

CREATE TABLE admin_user (
	id INTEGER NOT NULL, 
	username VARCHAR(50) NOT NULL, 
	password_hash VARCHAR(200) NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (username)
);

CREATE TABLE adoption_notes (
	id INTEGER NOT NULL, 
	adoption_id INTEGER NOT NULL, 
	note_date VARCHAR(10) NOT NULL, 
	content TEXT NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(adoption_id) REFERENCES adoptions (id)
);

CREATE TABLE adoptions (
	id INTEGER NOT NULL, 
	cat_id INTEGER, 
	name VARCHAR(50) NOT NULL, 
	phone VARCHAR(20) NOT NULL, 
	city VARCHAR(50) NOT NULL, 
	housing VARCHAR(100) NOT NULL, 
	experience VARCHAR(200), 
	family_agreed VARCHAR(100), 
	reason TEXT NOT NULL, 
	photos TEXT, 
	status VARCHAR(20) DEFAULT 'pending' NOT NULL, 
	admin_note TEXT, 
	adopted_at VARCHAR(10), 
	success_story TEXT, 
	success_photo VARCHAR(300), 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	CHECK (length(phone) >= 11), 
	CHECK (status IN ('pending','interview','home_check','adopted','rejected')), 
	FOREIGN KEY(cat_id) REFERENCES cats (id)
);

CREATE TABLE cats (
	id INTEGER NOT NULL, 
	name VARCHAR(50) NOT NULL, 
	persona VARCHAR(50), 
	story VARCHAR(200), 
	breed VARCHAR(50), 
	age VARCHAR(20), 
	gender VARCHAR(10), 
	neutered INTEGER DEFAULT '0' NOT NULL, 
	skills VARCHAR(200), 
	avatar_url VARCHAR(300), 
	adoptable INTEGER DEFAULT '0' NOT NULL, 
	status VARCHAR(20) DEFAULT 'active' NOT NULL, 
	sort_order INTEGER DEFAULT '0' NOT NULL, 
	deleted INTEGER DEFAULT '0' NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	CHECK (neutered IN (0,1)), 
	CHECK (adoptable IN (0,1)), 
	CHECK (status IN ('active','offline')), 
	CHECK (deleted IN (0,1))
);

CREATE TABLE menu_items (
	id INTEGER NOT NULL, 
	name VARCHAR(50) NOT NULL, 
	category VARCHAR(20) NOT NULL, 
	price INTEGER NOT NULL, 
	"desc" VARCHAR(200), 
	image_url VARCHAR(300), 
	status VARCHAR(20) DEFAULT 'on_sale' NOT NULL, 
	sort_order INTEGER DEFAULT '0' NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	CHECK (category IN ('coffee','tea','dessert','cat_snack')), 
	CHECK (price >= 0), 
	CHECK (status IN ('on_sale','off_shelf'))
);

CREATE TABLE qa (
	id INTEGER NOT NULL, 
	question TEXT NOT NULL, 
	nickname VARCHAR(30) NOT NULL, 
	phone VARCHAR(11), 
	status VARCHAR(20) DEFAULT 'pending' NOT NULL, 
	answer TEXT, 
	answered_at DATETIME, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	CHECK (status IN ('pending','answered'))
);

CREATE TABLE reservations (
	id INTEGER NOT NULL, 
	name VARCHAR(50) NOT NULL, 
	phone VARCHAR(20) NOT NULL, 
	reserve_date VARCHAR(10) NOT NULL, 
	slot VARCHAR(20) NOT NULL, 
	party_size INTEGER NOT NULL, 
	has_child INTEGER DEFAULT '0' NOT NULL, 
	remark TEXT, 
	status VARCHAR(20) DEFAULT 'pending_payment' NOT NULL, 
	deposit_amount INTEGER NOT NULL, 
	payment_proof TEXT, 
	verify_reject_reason VARCHAR(200), 
	payment_verified_at DATETIME, 
	cancel_reason VARCHAR(200), 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	CHECK (length(phone) >= 11), 
	CHECK (length(reserve_date) = 10), 
	CHECK (party_size BETWEEN 1 AND 6), 
	CHECK (has_child IN (0,1)), 
	CHECK (status IN ('pending_payment','payment_verify','verify_rejected','confirmed','completed','cancelled','no_show')), 
	CHECK (deposit_amount >= 0)
);

CREATE TABLE slot_settings (
	id INTEGER NOT NULL, 
	slot VARCHAR(20) NOT NULL, 
	capacity INTEGER DEFAULT '6' NOT NULL, 
	is_open INTEGER DEFAULT '1' NOT NULL, 
	holidays TEXT DEFAULT '[1]' NOT NULL, 
	PRIMARY KEY (id), 
	CHECK (capacity > 0), 
	CHECK (is_open IN (0,1)), 
	UNIQUE (slot)
);

CREATE TABLE store_settings (
	"key" VARCHAR(50) NOT NULL, 
	value TEXT, 
	PRIMARY KEY ("key")
);

CREATE INDEX idx_adopt_cat ON adoptions (cat_id);

CREATE INDEX idx_adopt_status ON adoptions (status);

CREATE INDEX idx_notes_adoption ON adoption_notes (adoption_id);

CREATE INDEX idx_qa_status ON qa (status);

CREATE INDEX idx_res_date_slot ON reservations (reserve_date, slot, status);

CREATE INDEX idx_res_phone ON reservations (phone);

CREATE INDEX idx_res_status ON reservations (status);

CREATE UNIQUE INDEX uq_res_phone_date ON reservations(phone, reserve_date) WHERE status IN ('pending_payment','payment_verify','verify_rejected','confirmed');
