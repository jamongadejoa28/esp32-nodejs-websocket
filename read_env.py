import os

'''
PlatformIO 환경에서 파이썬 전역 스코프(globals)에
env 객체를 직접 주입해 주지 않고, SCons 고유의 로드 메커니즘을 탄다.
env 객체를 가장 확실하고 안전하게 낚아채는 방법은 Import("env")를 문자열 그대로 호출하는 것
캐시 문제를 방지하기 위해 env.Append 대신 env.ProcessFlags를 사용
'''



# SCons 환경에서 전역으로 사용할 수 있는 Import 함수를 사용해 env 객체를 가져옵니다.
Import("env")

# 프로젝트 루트 폴더 경로 획득
env_dir = env.get("PROJECT_DIR")

# server/.env 파일 전체 경로 생성
env_file = os.path.join(env_dir, "server", ".env")

if os.path.exists(env_file):
    print(f"--- [Loading environment variables from {env_file}] ---")
    with open(env_file, "r") as f:
        for line in f:
            line = line.strip()
            # 빈 줄, 주석, '='이 없는 잘못된 포맷 스킵
            if not line or line.startswith("#") or "=" not in line:
                continue
                
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip()
            
            # 포트 번호처럼 완전히 순수 숫자인 경우 -> 정수로 주입
            if val.isdigit():
                env.Append(BUILD_FLAGS=[f'-D{key}={val}'])
                print(f"  > Injected Number Macro: {key}={val}")
            
            # IP 주소나 일반 문자열인 경우 -> C++용 이스케이프 문자열(\"\") 형태로 감싸서 주입
            else:
                env.Append(BUILD_FLAGS=[f'-D{key}=\"\\\"{val}\\\"\"'])
                print(f"  > Injected String Macro: {key}={val}")
    print("--------------------------------------------------")
else:
    print(f"--- [Warning: .env file not found at {env_file}] ---")