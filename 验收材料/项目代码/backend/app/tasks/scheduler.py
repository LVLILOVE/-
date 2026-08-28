"""定时任务：超时自动取消（PRD §6.1 / 开发技术文档 §8.3）"""
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from ..services.reservation import scan_expired_reservations


def start_scheduler() -> BackgroundScheduler:
    sched = BackgroundScheduler(timezone="Asia/Shanghai")
    sched.add_job(
        scan_expired_reservations,
        IntervalTrigger(minutes=5),
        id="scan_expired_reservations",
        replace_existing=True,
    )
    sched.start()
    return sched
