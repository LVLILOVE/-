class BizError(Exception):
    """业务异常：携带错误码与消息（见开发技术文档 §5.2）"""
    def __init__(self, code: int, msg: str):
        self.code = code
        self.msg = msg

def ok(data=None, msg="ok"):
    return {"code": 0, "msg": msg, "data": data}

def fail(code: int, msg: str):
    return {"code": code, "msg": msg, "data": None}
