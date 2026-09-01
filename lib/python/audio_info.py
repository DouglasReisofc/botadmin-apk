import os
import sys
import json

def obter_informacoes_audio(id_unico):
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        arquivo_json = os.path.join(base_dir, 'audios.json')
        if not os.path.exists(arquivo_json):
            raise FileNotFoundError(f"Arquivo JSON {arquivo_json} não encontrado.")
        with open(arquivo_json, 'r') as f:
            dados_existentes = json.load(f)
        if id_unico not in dados_existentes:
            raise KeyError(f"ID {id_unico} não encontrado nos dados.")
        audio_info = dados_existentes[id_unico]
        return json.dumps({'status': 'success', 'audio_info': audio_info})
    except Exception as e:
        return json.dumps({'status': 'error', 'message': str(e)})

if __name__ == "__main__":
    id_unico = sys.argv[1]
    result = obter_informacoes_audio(id_unico)
    print(result)

